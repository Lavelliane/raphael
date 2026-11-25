"""Start Raphael's local desktop workspace with Python 3.10+."""
import argparse
import json
import mimetypes
import secrets
import threading
import time
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

from assistant import ACTIONS, PERSONALITIES, answer
from audio import Listener, outputs

UI = Path(__file__).parent / "ui"


class Session:
    def __init__(self, whisper_port):
        self.port = whisper_port
        self.lock = threading.RLock()
        self.listener = None
        self.generation = 0
        self.turns = deque(maxlen=180)
        self.next_id = 0
        self.error = ""
        self.dropped = 0
        self.level = 0
        self.started = None

    def state(self):
        with self.lock:
            return dict(active=self.listener is not None, error=self.error, turns=list(self.turns),
                        level=self.level, dropped=self.dropped, started=self.started)

    def stop(self):
        with self.lock:
            self.generation += 1
            if self.listener:
                self.listener.halt.set()
            self.listener = None
            self.level = 0

    def start(self, device):
        try:
            with urlopen(f"http://127.0.0.1:{self.port}/health", timeout=3) as response:
                if response.status != 200:
                    raise ValueError("Whisper is loading. Try again in a moment.")
        except OSError as exc:
            raise ValueError(f"Start whisper-server on 127.0.0.1:{self.port} first. See README → Live transcription.") from exc
        with self.lock:
            if self.listener:
                raise ValueError("Capture is already running.")
            self.generation += 1
            generation = self.generation
            self.error = ""
            self.dropped = 0
            if self.started is None:
                self.started = time.time()

            def apply(fn):
                def guarded(*args):
                    with self.lock:
                        if generation == self.generation:
                            fn(*args)
                return guarded

            def turn(text):
                self.next_id += 1
                self.turns.append(dict(id=self.next_id, text=text, timestamp=time.time()))

            def fail(message):
                self.error = message
                self.stop()

            self.listener = Listener(device, self.port, apply(turn), apply(fail),
                                     apply(lambda x: setattr(self, "level", x)),
                                     apply(lambda: setattr(self, "dropped", self.dropped + 1)))
            self.listener.start()


def make_server(port, whisper_port):
    state, key = Session(whisper_port), secrets.token_urlsafe(32)
    answering = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass

        def send(self, status, content, mime="application/json"):
            payload = json.dumps(content).encode() if mime == "application/json" else content
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def allowed(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {})
            path = self.path.split("?", 1)[0]
            if path == "/":
                page = (UI / "index.html").read_text().replace("SESSION_TOKEN", key)
                return self.send(200, page.encode(), "text/html; charset=utf-8")
            if path in ("/app.js", "/style.css", "/mark.svg"):
                return self.send(200, (UI / path[1:]).read_bytes(), mimetypes.guess_type(path)[0])
            return self.send(404, {})

        def do_POST(self):
            if not self.allowed() or self.headers.get("X-Raphael-Token") != key:
                return self.send(403, {})
            try:
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 65536:
                    return self.send(413, {})
                data = json.loads(self.rfile.read(size))
                if self.path == "/api/state":
                    return self.send(200, state.state())
                if self.path == "/api/devices":
                    return self.send(200, [dict(id=str(x.id), name=x.name) for x in outputs()])
                if self.path == "/api/start":
                    state.start(str(data["device"]))
                elif self.path == "/api/stop":
                    state.stop()
                elif self.path == "/api/new":
                    with state.lock:
                        state.stop()
                        state.turns.clear()
                        state.started, state.error, state.dropped = None, "", 0
                elif self.path == "/api/folder":
                    folder = Path(str(data["path"])).expanduser().resolve(strict=True)
                    if not folder.is_dir():
                        raise ValueError("Select a folder.")
                    return self.send(200, dict(path=str(folder), name=folder.name or str(folder)))
                elif self.path == "/api/source":
                    base = Path(data["folder"]).resolve(strict=True)
                    relative, _, line = str(data["source"]).rpartition(":")
                    target = (base / relative).resolve(strict=True)
                    if not (line.isdigit() and int(line) > 0 and target.is_relative_to(base)
                            and not Path(relative).is_absolute() and target.is_file()):
                        raise ValueError("Source reference unavailable.")
                    if target.stat().st_size > 3_000_000:
                        raise ValueError("File is too large to preview.")
                    lines = target.read_text(encoding="utf-8").splitlines()
                    at = int(line) - 1
                    if at >= len(lines):
                        raise ValueError("The cited line no longer exists.")
                    excerpt = "\n".join(f"{i+1:4}  {lines[i][:400]}" for i in range(max(0, at-3), min(len(lines), at+4)))
                    return self.send(200, dict(excerpt=excerpt))
                elif self.path == "/api/answer":
                    action = data["action"]
                    personality = data.get("personality", "sage")
                    if action not in ACTIONS or personality not in PERSONALITIES:
                        raise ValueError("Unknown action or personality.")
                    folder = data.get("folder", "")
                    if folder and not Path(folder).is_dir():
                        raise ValueError("The selected folder is unavailable.")
                    if not answering.acquire(blocking=False):
                        return self.send(409, dict(error="An answer is already in progress."))
                    try:
                        result = answer(action, [str(x)[:1400] for x in data.get("turns", [])][-12:],
                                        data.get("topics", [])[:12], folder,
                                        str(data.get("question", ""))[:2000], personality)
                    finally:
                        answering.release()
                    return self.send(200, result)
                else:
                    return self.send(404, {})
                self.send(200, state.state())
            except Exception as exc:
                self.send(400, dict(error=str(exc)))

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return server, state


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--port", type=int, default=8765)
    cli.add_argument("--whisper-port", type=int, default=8080)
    cli.add_argument("--no-browser", action="store_true")
    args = cli.parse_args()
    server, state = make_server(args.port, args.whisper_port)
    address = f"http://127.0.0.1:{server.server_port}"
    print(f"Raphael is ready at {address}", flush=True)
    if not args.no_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        state.stop()
        server.server_close()
