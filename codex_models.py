"""Discover model choices from the installed Codex CLI and resolve meeting preferences."""
import json
import os
import re
import shutil
import subprocess
import threading
import time


def codex_environment():
    env = os.environ.copy()
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
        env.pop(key, None)
    return env


def listed_models(binary):
    """Read the same visible model list used by Codex app-server clients."""
    with subprocess.Popen([binary, "app-server", "-c", 'model_provider="openai"'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env=codex_environment(), text=True, encoding="utf-8") as process:
        def send(message):
            process.stdin.write(json.dumps(message) + "\n")
            process.stdin.flush()

        def request(number, method, params):
            send(dict(id=number, method=method, params=params))
            for line in process.stdout:
                message = json.loads(line)
                if message.get("id") == number:
                    if "error" in message:
                        raise ValueError(f"Codex could not complete {method}")
                    return message["result"]
            raise ValueError("Codex model discovery stopped.")

        timer = threading.Timer(8, process.kill)
        timer.start()
        try:
            request(1, "initialize", {"clientInfo": {"name": "raphael", "version": "1"}})
            send({"method": "initialized"})
            models, cursor, index = [], None, 2
            while True:
                page = request(index, "model/list", {"limit": 100, "cursor": cursor})
                for item in page["data"]:
                    models.append(dict(id=item["model"], name=item.get("displayName") or item["model"],
                                       efforts=[e["reasoningEffort"] for e in item["supportedReasoningEfforts"]]))
                cursor = page.get("nextCursor")
                if not cursor:
                    return models
                index += 1
        finally:
            timer.cancel()
            process.kill()


def discover(binary):
    try:
        return listed_models(binary)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Some CLI installations can print the catalog but cannot start app-server.
        result = subprocess.run([binary, "debug", "models", "-c", 'model_provider="openai"'],
                                capture_output=True, text=True, env=codex_environment(),
                                check=True, timeout=8)
        return [dict(id=m["slug"], name=m.get("display_name") or m["slug"],
                     efforts=[e["effort"] for e in m.get("supported_reasoning_levels", [])])
                for m in json.loads(result.stdout)["models"] if m.get("visibility") == "list"]


class ModelCatalog:
    def __init__(self):
        self.lock = threading.Lock()
        self.expires = 0
        self.value = {}

    def get(self):
        with self.lock:
            if time.monotonic() < self.expires:
                return self.value
            models = []
            try:
                binary = shutil.which("codex")
                if binary:
                    models = discover(binary)
            except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
                models = []
            light = next((m for m in models if re.search(r"(?:^|[-.])(mini|nano|spark|luna)(?:[-.]|$)", m["id"])), None)
            fast = light or next(iter(models), None)
            self.value = dict(models=models, fast=fast["id"] if fast else "")
            self.expires = time.monotonic() + (300 if models else 30)
            return self.value

    def arguments(self, choice):
        if choice == "default":
            return []
        catalog = self.get()
        selected = catalog["fast"] if choice == "fast" else choice
        if not selected and choice == "fast":
            return []  # Older CLI versions can still use the configured model.
        model = next((m for m in catalog["models"] if m["id"] == selected), None)
        if not model:
            raise ValueError("That model is unavailable in the local Codex catalog. Choose another model in Settings.")
        args = ["--model", selected]
        effort = next((e for e in ("low", "minimal", "none") if e in model["efforts"]), None)
        if effort:
            args.extend(["-c", f'model_reasoning_effort="{effort}"'])
        return args


catalog = ModelCatalog()
