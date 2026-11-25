import hashlib
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import textwrap
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import whisper_service as whisper


class WhisperStartupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        self.model = self.folder / "model.bin"
        self.service = whisper.WhisperService(port, self.model)
        self.addCleanup(self.service.close)

    def test_start_reuse_and_stop_local_process(self):
        self.model.write_bytes(b"fixture")
        script = self.folder / "engine.py"
        script.write_text(textwrap.dedent("""
            import http.server, sys
            class Handler(http.server.BaseHTTPRequestHandler):
                server_version = "whisper.cpp"
                def do_GET(self):
                    self.send_response(200 if self.path == '/health' else 404)
                    self.end_headers()
                    self.wfile.write(b'{"status":"ok"}')
                def log_message(self, *args): pass
            port = int(sys.argv[sys.argv.index('--port') + 1])
            http.server.HTTPServer(('127.0.0.1', port), Handler).serve_forever()
        """))
        real_popen = subprocess.Popen
        def start(args):
            self.assertEqual(args[1:], ["-m", str(self.model), "-l", "auto", "--host",
                                        "127.0.0.1", "--port", str(self.service.port)])
            return real_popen([sys.executable, str(script), *args[1:]])
        with patch.object(shutil, "which", return_value="whisper-server"), \
             patch.object(subprocess, "Popen", side_effect=start) as launch:
            self.service.ensure_ready()
            child = self.service.process
            self.service.ensure_ready()
            self.assertEqual(launch.call_count, 1)
            external = whisper.WhisperService(self.service.port)
            external.ensure_ready()
            external.close()
            self.assertIsNone(child.poll())
            self.service.close()
            self.assertIsNotNone(child.poll())

    def test_unrelated_server_is_left_alone(self):
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode())
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.service.port = server.server_port
        with patch.object(subprocess, "Popen") as launch:
            with self.assertRaisesRegex(ValueError, "--whisper-port"):
                self.service.ensure_ready()
            launch.assert_not_called()

    def test_missing_binary_or_model_has_setup_command(self):
        for binary in (None, "whisper-server"):
            with self.subTest(binary=binary), patch.object(shutil, "which", return_value=binary):
                with self.assertRaisesRegex(ValueError, "--setup-whisper"):
                    self.service.ensure_ready()

    def test_setup_is_atomic_and_can_be_repeated(self):
        data = b"fixture-model"
        self.model.write_bytes(b"incomplete")
        def download(args, check):
            self.assertTrue(check)
            Path(args[args.index("--output") + 1]).write_bytes(data)
        with patch.object(sys, "platform", "darwin"), patch.object(whisper, "DEFAULT_MODEL", self.model), \
             patch.object(shutil, "which", return_value="whisper-server"), \
             patch.object(subprocess, "run", side_effect=download) as run:
            with self.assertRaisesRegex(ValueError, "checksum"):
                whisper.setup_mac_whisper()
            self.assertEqual(self.model.read_bytes(), b"incomplete")
            with patch.object(whisper, "MODEL_SHA256", hashlib.sha256(data).hexdigest()):
                whisper.setup_mac_whisper()
                whisper.setup_mac_whisper()
            self.assertEqual(self.model.read_bytes(), data)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(list(self.folder.iterdir()), [self.model])

    def test_fast_setup_verifies_base_and_keeps_balanced_model(self):
        fast = self.folder / "ggml-base-q5_1.bin"
        self.model.write_bytes(b"installed-small")
        sample = b"fast-model"
        def download(args, check):
            self.assertTrue(args[-1].endswith("/ggml-base-q5_1.bin"))
            Path(args[args.index("--output") + 1]).write_bytes(sample)
        with patch.object(sys, "platform", "darwin"), patch.object(whisper, "DEFAULT_MODEL", self.model), \
             patch.object(whisper, "FAST_MODEL", fast), patch.object(whisper, "FAST_SHA256", hashlib.sha256(sample).hexdigest()), \
             patch.object(shutil, "which", return_value="whisper-server"), patch.object(subprocess, "run", side_effect=download) as run:
            whisper.setup_mac_whisper("fast")
            whisper.setup_mac_whisper("fast")
            run.assert_called_once()
        self.assertEqual(fast.read_bytes(), sample)
        self.assertEqual(self.model.read_bytes(), b"installed-small")
