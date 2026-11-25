"""Capture a playback endpoint and stream bounded utterances to local whisper.cpp."""
import io
import json
import platform
import queue
import threading
import uuid
import wave
from collections import deque
from urllib.request import Request, urlopen


def dependencies():
    try:
        import numpy as np
        import soundcard as sc
    except (ImportError, OSError, AssertionError, RuntimeError) as exc:
        raise RuntimeError("Audio backend unavailable. Install requirements.txt and check your playback device.") from exc
    return np, sc


def outputs():
    _, sc = dependencies()
    inputs = sc.all_microphones(include_loopback=True)
    if platform.system() == "Darwin":
        return [m for m in inputs if "blackhole" in m.name.lower()]
    return [m for m in inputs if m.isloopback]


def wav_bytes(pcm):
    data = io.BytesIO()
    with wave.open(data, "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    return data.getvalue()


def transcribe(pcm, port):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in [("language", "auto"), ("temperature", "0"), ("response_format", "json")]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="turn.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode())
    parts.extend([wav_bytes(pcm), f"\r\n--{boundary}--\r\n".encode()])
    req = Request(f"http://127.0.0.1:{port}/inference", data=b"".join(parts),
                  headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urlopen(req, timeout=60) as response:
        result = json.load(response)
    if "text" not in result:
        raise RuntimeError("Whisper returned no transcript. Check the whisper-server log.")
    return result["text"].strip()


class Listener:
    def __init__(self, device_id, port, on_turn, on_error, on_level, on_drop):
        self.device_id, self.port = device_id, port
        self.on_turn, self.on_error, self.on_level, self.on_drop = on_turn, on_error, on_level, on_drop
        self.halt = threading.Event()
        self.pending = queue.Queue(maxsize=3)

    def start(self):
        threading.Thread(target=self.capture, daemon=True).start()
        threading.Thread(target=self.decode, daemon=True).start()

    def enqueue(self, chunks):
        try:
            self.pending.put_nowait(b"".join(chunks))
        except queue.Full:
            self.on_drop()

    def capture(self):
        try:
            np, _ = dependencies()
            source = next((m for m in outputs() if str(m.id) == self.device_id), None)
            if source is None:
                raise RuntimeError("Playback device disappeared. Refresh devices and choose it again.")
            # WASAPI needs multichannel capture on some drivers. Downmix here.
            with source.recorder(samplerate=16000) as recorder:
                pre = deque(maxlen=2)
                chunks, quiet = [], 0
                while not self.halt.is_set():
                    frames = recorder.record(numframes=3200).mean(axis=1)
                    level = float(np.sqrt(np.mean(frames ** 2)))
                    self.on_level(min(1, level * 7))
                    block = (np.clip(frames, -1, 1) * 32767).astype("<i2").tobytes()
                    if not chunks and level < 0.005:
                        pre.append(block)
                        continue
                    if not chunks:
                        chunks.extend(pre)
                        pre.clear()
                    chunks.append(block)
                    quiet = quiet + 1 if level < 0.005 else 0
                    if quiet >= 4 or len(chunks) >= 50:
                        self.enqueue(chunks)
                        chunks, quiet = [], 0
        except Exception as exc:
            if not self.halt.is_set():
                self.on_error(str(exc))
            self.halt.set()

    def decode(self):
        while not self.halt.is_set():
            try:
                chunk = self.pending.get(timeout=0.3)
            except queue.Empty:
                continue
            try:
                text = transcribe(chunk, self.port)
                if text and not self.halt.is_set():
                    self.on_turn(text)
            except Exception as exc:
                if not self.halt.is_set():
                    self.on_error(f"Local transcription failed: {exc}")
                self.halt.set()
