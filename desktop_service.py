"""Run the private desktop engine for the lifetime of the Electron parent pipe."""
import json
import os
from pathlib import Path
import sys
import threading

from raphael import make_server
from whisper_service import DEFAULT_MODEL, FAST_MODEL


def run():
    configured = os.environ.get("RAPHAEL_WHISPER_MODEL")
    if configured:
        model = Path(configured).expanduser()
    elif getattr(sys, "frozen", False):
        model = Path(sys.executable).resolve().parent.parent / "models/meeting-model.bin"
    else:
        model = FAST_MODEL if FAST_MODEL.is_file() else DEFAULT_MODEL
    server, state = make_server(0, int(os.environ.get("RAPHAEL_WHISPER_PORT", 8080)), model, desktop=True)
    def watch_parent():
        sys.stdin.buffer.read()
        server.shutdown()
    threading.Thread(target=watch_parent, daemon=True).start()
    print(json.dumps(dict(port=server.server_port, token=server.desktop_token)), flush=True)
    try:
        server.serve_forever(poll_interval=.1)
    finally:
        state.stop()
        state.copilot.close()
        state.whisper.close()
        server.server_close()


if __name__ == "__main__":
    run()
