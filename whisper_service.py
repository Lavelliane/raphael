"""Start or reuse the local whisper.cpp service used for meeting audio."""
import errno
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


DEFAULT_MODEL = Path(__file__).resolve().parent / "models" / "ggml-small-q5_1.bin"
MODEL_REVISION = "87cd18b47b941d2f65d09981dad23bb7d0481c77"
FAST_MODEL = DEFAULT_MODEL.with_name("ggml-base-q5_1.bin")
FAST_SHA256 = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898"
MODEL_SHA256 = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
SETUP_HINT = "On macOS, run python raphael.py --setup-whisper from the checkout."


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def setup_mac_whisper(preset="balanced"):
    model, expected, size = ((FAST_MODEL, FAST_SHA256, 57) if preset == "fast"
                             else (DEFAULT_MODEL, MODEL_SHA256, 181))
    if sys.platform != "darwin":
        raise ValueError("Use the whisper.cpp installation instructions for your OS in the README.")
    if not shutil.which("whisper-server"):
        brew = shutil.which("brew")
        if not brew:
            raise ValueError("Install Homebrew from https://brew.sh and rerun with --setup-whisper.")
        subprocess.run([brew, "install", "whisper.cpp"], check=True)
        if not shutil.which("whisper-server"):
            raise ValueError("Homebrew installed whisper.cpp. Add Homebrew's bin directory to PATH and retry.")
    if model.is_file() and checksum(model) == expected:
        return
    model.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading the multilingual Whisper model ({size} MiB) to {model}", flush=True)
    with tempfile.NamedTemporaryFile(dir=model.parent, delete=False) as temp:
        pending = Path(temp.name)
    try:
        subprocess.run(["curl", "--fail", "--location", "--retry", "3",
                        "--output", str(pending), f"https://huggingface.co/ggerganov/whisper.cpp/resolve/{MODEL_REVISION}/{model.name}"], check=True)
        if checksum(pending) != expected:
            raise ValueError("Whisper model download failed its checksum. Rerun with --setup-whisper.")
        pending.replace(model)
    finally:
        pending.unlink(missing_ok=True)


class WhisperService:
    def __init__(self, port, model=DEFAULT_MODEL):
        self.port = port
        self.model = Path(model).expanduser().resolve()
        self.process = None
        self.lock = threading.Lock()
        self.closing = threading.Event()

    def health(self):
        occupied = (f"Port {self.port} did not return a whisper.cpp health response. "
                    "Restart Raphael with --whisper-port followed by a free port.")
        try:
            with urlopen(f"http://127.0.0.1:{self.port}/health", timeout=2) as response:
                if "whisper.cpp" not in ",".join(response.headers.get_all("Server", [])):
                    raise ValueError(occupied)
                data = response.read(2048)
        except HTTPError as exc:
            with exc:
                if exc.code == 503 and "whisper.cpp" in ",".join(exc.headers.get_all("Server", [])):
                    return "loading"
                raise ValueError(occupied) from exc
        except URLError as exc:
            if getattr(exc.reason, "errno", None) == errno.ECONNREFUSED:
                return "offline"
            raise ValueError(f"Could not reach the local Whisper service: {exc.reason}") from exc
        try:
            payload = json.loads(data)
            if isinstance(payload, dict) and payload.get("status") == "ok":
                return "ready"
        except (UnicodeError, ValueError):
            pass
        raise ValueError(occupied)

    def ensure_ready(self):
        with self.lock:
            if self.closing.is_set():
                raise ValueError("Raphael is shutting down.")
            if self.process is not None and self.process.poll() is not None:
                self.process = None
            status = self.health()
            if status == "ready":
                return
            if status == "offline" and self.process is None:
                binary = shutil.which("whisper-server")
                if not binary:
                    raise ValueError("Install whisper.cpp to enable transcription. " + SETUP_HINT)
                if not self.model.is_file():
                    raise ValueError(f"Missing Whisper model at {self.model}. {SETUP_HINT} "
                                     "Or select an installed model using --whisper-model PATH.")
                self.process = subprocess.Popen([binary, "-m", str(self.model), "-l", "auto",
                                                 "--host", "127.0.0.1", "--port", str(self.port)])
            deadline = time.monotonic() + 60
            while not self.closing.wait(0.25):
                if self.process is not None and self.process.poll() is not None:
                    self.process = None
                    raise ValueError("Whisper exited during startup. See the error in Raphael’s terminal.")
                if self.health() == "ready":
                    return
                if time.monotonic() >= deadline:
                    raise ValueError("Whisper is taking over a minute to load. Check Raphael’s terminal and retry.")
            raise ValueError("Raphael is shutting down.")

    def close(self):
        self.closing.set()
        with self.lock:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
            self.process = None
