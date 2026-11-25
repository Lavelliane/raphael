"""Capture a playback endpoint and stream bounded utterances to local whisper.cpp."""
import io
import json
import platform
import queue
import sys
import threading
import uuid
import wave
import warnings
from collections import deque
from typing import NamedTuple
from urllib.request import Request, urlopen


BLOCK_FRAMES = 3200
PAUSE_BLOCKS = 2  # 400 ms at 16 kHz
MAX_BLOCKS = 20  # 4 seconds of uninterrupted speech
MAC_SYSTEM_ID = "coreaudio:system"


class Output(NamedTuple):
    id: str
    name: str


def soundcard_outputs():
    try:
        # SoundCard emits this warning on import even for BlackHole, a regular input.
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="macOS does not support loopback recording functionality",
                                    module=r"soundcard\.coreaudio")
            import soundcard as sc
        inputs = sc.all_microphones(include_loopback=True)
    except (ImportError, OSError, AssertionError, RuntimeError) as exc:
        raise RuntimeError("Audio backend unavailable. Install requirements.txt and check your playback device.") from exc
    if platform.system() == "Darwin":
        return [m for m in inputs if "blackhole" in m.name.lower()]
    return [m for m in inputs if m.isloopback]


def outputs():
    if platform.system() == "Darwin":
        version = tuple(int(part) for part in platform.mac_ver()[0].split(".")[:2] if part)
        if version >= (14, 2) and sys.version_info >= (3, 11):
            native = Output(MAC_SYSTEM_ID, "Mac system audio (Core Audio)")
            try:
                legacy = soundcard_outputs()
            except RuntimeError:
                legacy = []
            return [native, *legacy]
    return soundcard_outputs()


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
        self._native_lock = threading.Lock()
        self._native = None

    def start(self):
        threading.Thread(target=self.capture, daemon=True).start()
        threading.Thread(target=self.decode, daemon=True).start()

    def enqueue(self, chunks):
        try:
            self.pending.put_nowait(b"".join(chunks))
        except queue.Full:
            self.on_drop()

    def stop(self):
        self.halt.set()
        # Wake the native stream even if the Mac is playing no audio.
        with self._native_lock:
            if self._native is not None:
                try:
                    self._native.stop_recording()
                finally:
                    self._native = None

    def mac_blocks(self):
        try:
            from pysysaudio import SystemAudioRecorder
        except ImportError as exc:
            raise RuntimeError("Install the Mac audio backend with python -m pip install -r requirements.txt.") from exc
        recorder = SystemAudioRecorder(sample_rate=16000, channels=1, format="bytes", dtype="int16")
        try:
            recorder.start_recording()
        except RuntimeError as exc:
            raise RuntimeError(f"Core Audio could not start: {exc}. Check Screen & System Audio Recording "
                               "permission for the app running Raphael.") from exc
        with self._native_lock:
            if self.halt.is_set():
                recorder.stop_recording()
                return
            self._native = recorder
        pending = bytearray()
        block_bytes = 2 * BLOCK_FRAMES
        try:
            for chunk in recorder.stream():
                if self.halt.is_set():
                    return
                pending.extend(chunk)
                while len(pending) >= block_bytes:
                    yield bytes(pending[:block_bytes])
                    del pending[:block_bytes]
            if not self.halt.is_set():
                raise RuntimeError("Mac system audio capture ended. Start listening again.")
        finally:
            with self._native_lock:
                if self._native is recorder:
                    self._native = None
                    recorder.stop_recording()

    def soundcard_blocks(self, np):
        source = next((m for m in soundcard_outputs() if str(m.id) == self.device_id), None)
        if source is None:
            raise RuntimeError("Playback device disappeared. Refresh devices and choose it again.")
        # WASAPI needs multichannel capture on some drivers. Downmix here.
        with source.recorder(samplerate=16000) as recorder:
            while not self.halt.is_set():
                frames = recorder.record(numframes=BLOCK_FRAMES).mean(axis=1)
                yield (np.clip(frames, -1, 1) * 32767).astype("<i2").tobytes()

    def capture(self):
        try:
            import numpy as np
            if self.device_id == MAC_SYSTEM_ID and platform.system() == "Darwin":
                blocks = self.mac_blocks()
            else:
                blocks = self.soundcard_blocks(np)
            pre = deque(maxlen=2)
            chunks, quiet = [], 0
            for block in blocks:
                if self.halt.is_set():
                    break
                frames = np.frombuffer(block, dtype="<i2").astype(np.float32) / 32768
                level = float(np.sqrt(np.mean(frames ** 2)))
                self.on_level(min(1, level * 7))
                if not chunks and level < 0.005:
                    pre.append(block)
                    continue
                if not chunks:
                    chunks.extend(pre)
                    pre.clear()
                chunks.append(block)
                quiet = quiet + 1 if level < 0.005 else 0
                if quiet >= PAUSE_BLOCKS or len(chunks) >= MAX_BLOCKS:
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
