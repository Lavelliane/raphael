import json
import subprocess
import sys
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


class DesktopEngineTests(unittest.TestCase):
    def test_private_session_handshake_and_parent_exit(self):
        script = Path(__file__).resolve().parents[1] / "desktop_service.py"
        with subprocess.Popen([sys.executable, str(script)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as child:
            try:
                hello = json.loads(child.stdout.readline())
                origin = f"http://127.0.0.1:{hello['port']}"
                with self.assertRaises(HTTPError) as page:
                    urlopen(origin, timeout=2)
                self.assertEqual(page.exception.code, 403)
                with self.assertRaises(HTTPError) as no_token:
                    urlopen(Request(origin + "/api/state", data=b"{}"), timeout=2)
                self.assertEqual(no_token.exception.code, 403)
                req = Request(origin + "/api/state", data=b"{}", headers={"X-Raphael-Token":hello["token"]})
                with urlopen(req, timeout=2) as response:
                    self.assertFalse(json.load(response)["active"])
                child.stdin.close()
                self.assertEqual(child.wait(timeout=4), 0)
            finally:
                if child.poll() is None:
                    child.kill()
