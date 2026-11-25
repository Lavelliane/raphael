"""Coalesce finalized speech and suggest a single useful card in the background."""
import re
import threading
import time
from collections import deque
from pathlib import Path

from assistant import PERSONALITIES, answer


def preferences(data):
    folder = str(data.get("folder") or "")
    if folder and not Path(folder).is_dir():
        raise ValueError("The selected folder is unavailable.")
    personality = data.get("personality", "sage")
    if personality not in PERSONALITIES:
        raise ValueError("Unknown personality.")
    return dict(enabled=data.get("enabled") is True, folder=str(Path(folder).resolve()) if folder else "",
                topics=[str(t)[:120] for t in data.get("topics", [])[:12]],
                personality=personality, model=str(data.get("model", "fast"))[:120])


def words(text):
    return " ".join(re.findall(r"\w+", text.casefold()))


FILLER = {"", "ok", "okay", "thank you", "thanks", "uh", "um", "yeah", "yes", "oo", "opo",
          "sige", "salamat", "music", "applause", "silence", "blank audio"}


class HandsFree:
    def __init__(self, generate=answer, cooldown=15, settle=1):
        self.generate, self.cooldown, self.settle = generate, cooldown, settle
        self.changed = threading.Condition()
        self.settings = preferences({})
        self.history = deque(maxlen=12)
        self.cards = deque(maxlen=50)
        self.closed = False
        self.version = self.cursor = self.card_id = 0
        self.next_call = 0
        self.busy = False
        self.error = ""
        self.worker = None

    def configure(self, settings, clear=False):
        with self.changed:
            self.settings = settings
            self.version += 1
            self.history.clear()
            self.next_call = 0
            self.error = ""
            self.busy = False
            if clear:
                self.cards.clear()
            self.changed.notify_all()

    def stop(self, clear=False):
        self.configure({**self.settings, "enabled": False}, clear)

    def close(self):
        with self.changed:
            self.closed = True
            self.stop()
            self.changed.notify_all()

    def heard(self, turn):
        with self.changed:
            if not self.settings["enabled"] or self.closed:
                return
            name = words(turn["text"])
            if name in FILLER or (self.history and name == words(self.history[-1]["text"])):
                return
            self.history.append(turn)
            if self.worker is None:
                self.worker = threading.Thread(target=self._run, name="raphael-hands-free", daemon=True)
                self.worker.start()
            self.changed.notify()

    def state(self):
        with self.changed:
            return dict(enabled=self.settings["enabled"], busy=self.busy, error=self.error,
                        cards=list(self.cards))

    def _run(self):
        while True:
            with self.changed:
                self.changed.wait_for(lambda: self.closed or (self.history and self.history[-1]["id"] > self.cursor))
                if self.closed:
                    return
                version = self.version
                # Wait briefly for adjacent fragments, without pushing the deadline on each arrival.
                due = max(self.next_call, time.monotonic() + self.settle)
                self.changed.wait_for(lambda: self.version != version or self.closed,
                                      timeout=max(0, due - time.monotonic()))
                if self.version != version or self.closed:
                    continue
                settings = self.settings
                fresh = [t["text"][:1400] for t in self.history if t["id"] > self.cursor]
                context = [t["text"][:1400] for t in self.history if t["id"] <= self.cursor]
                self.cursor = self.history[-1]["id"]
                previous = [dict(title=c["title"], body=c["body"]) for c in list(self.cards)[-3:]]
                self.next_call = time.monotonic() + self.cooldown
                self.busy = True
            try:
                card = self.generate("auto", context, settings["topics"], settings["folder"], "",
                                     settings["personality"], settings["model"], fresh, previous)
                error = ""
            except Exception as exc:
                error = str(exc) or "Codex could not complete automatic assistance."
                card = None
            with self.changed:
                if self.version != version:
                    continue
                self.error, self.busy = error, False
                if error:
                    self.next_call = time.monotonic() + 60
                if card and card["kind"] != "skip" and card["body"].strip():
                    recent = list(self.cards)[-5:]
                    if not any(words(c["body"]) == words(card["body"]) for c in recent):
                        self.card_id += 1
                        self.cards.append(dict(card, id=self.card_id, timestamp=time.time(), folder=settings["folder"]))
