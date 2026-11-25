import io
import json
import tempfile
import threading
import unittest
import wave
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from assistant import answer
from audio import wav_bytes
from raphael import make_server


class LocalServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server, cls.session = make_server(0, 8080)
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        with urlopen(cls.url) as r:
            cls.token = r.read().decode().split('name="raphael-token" content="')[1].split('"')[0]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, route, data, token=None):
        req = Request(self.url + "/api/" + route, data=json.dumps(data).encode(),
                      headers={"X-Raphael-Token": self.token if token is None else token})
        with urlopen(req) as r:
            return json.load(r)

    def test_local_api_requires_token(self):
        with self.assertRaises(HTTPError) as caught:
            self.post("state", {}, "incorrect")
        self.assertEqual(caught.exception.code, 403)

    def test_folder_and_source_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "design.md").write_text("decision\nreason\n")
            folder = self.post("folder", {"path": tmp})
            result = self.post("source", {"folder": folder["path"], "source": "design.md:2"})
            self.assertIn("2  reason", result["excerpt"])
            with self.assertRaises(HTTPError):
                self.post("source", {"folder": tmp, "source": "design.md:20"})

    def test_new_session_clears_in_memory_data(self):
        self.session.turns.append({"text": "draft"})
        self.assertEqual(self.post("new", {})["turns"], [])

    def test_wav_contract(self):
        pcm = bytes(32000)
        with wave.open(io.BytesIO(wav_bytes(pcm))) as wav:
            self.assertEqual((wav.getframerate(), wav.getnchannels(), wav.getsampwidth()), (16000, 1, 2))
            self.assertEqual(wav.readframes(16000), pcm)

    def test_codex_personality_and_source_contract(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "notes.md").write_text("use repositories")
            def fake(args, **kw):
                if "status" in args:
                    return CompletedProcess(args, 0, "", "Logged in using ChatGPT")
                self.assertIn("skeptical", kw["input"])
                self.assertIn("read-only", args)
                self.assertEqual(kw["cwd"], folder)
                target = Path(args[args.index("--output-last-message")+1])
                target.write_text(json.dumps(dict(title="Check coverage", body="Verify checkout first.",
                                                  source="notes.md:1", nodes=[])))
                return CompletedProcess(args, 0)
            with patch("assistant.shutil.which", return_value="codex"), patch("assistant.subprocess.run", side_effect=fake):
                reply = answer("check", ["migrated na"], [], folder, "", "reviewer")
            self.assertEqual(reply["source"], "notes.md:1")

    def test_api_key_login_cannot_activate_codex(self):
        with patch("assistant.shutil.which", return_value="codex"), patch("assistant.subprocess.run",
                   return_value=CompletedProcess([], 0, "Logged in using an API key", "")) as cli:
            with self.assertRaisesRegex(ValueError, "ChatGPT"):
                answer("ask", [], [], "", "What changed?", "sage")
            self.assertEqual(cli.call_count, 1)
