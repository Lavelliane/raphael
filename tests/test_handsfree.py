import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import Mock, patch

from assistant import answer
from codex_models import ModelCatalog
from handsfree import HandsFree, preferences


def until(predicate):
    deadline = time.monotonic() + 2
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("Timed out waiting for the assistant")
        time.sleep(.005)


def card(kind="followup", body="How will we roll back checkout?"):
    return dict(kind=kind, title="Rollback", body=body, source="", nodes=[])


class HandsFreeTests(unittest.TestCase):
    def start_worker(self, generate):
        assistant = HandsFree(generate=generate, settle=.01, cooldown=.03)
        self.addCleanup(assistant.close)
        assistant.configure(preferences(dict(enabled=True)))
        return assistant

    def test_auto_considers_new_speech_without_topic_keyword_and_coalesces_while_busy(self):
        started, release = threading.Event(), threading.Event()
        calls = []
        def respond(*args):
            calls.append(args)
            started.set()
            release.wait(2)
            return card()
        worker = self.start_worker(respond)
        worker.heard(dict(id=1, text="Okay."))
        worker.heard(dict(id=2, text="Anong gagawin natin sa checkout?"))
        self.assertTrue(started.wait(1))
        worker.heard(dict(id=3, text="Per feature tayo."))
        worker.heard(dict(id=4, text="May rollback ba?"))
        release.set()
        until(lambda: len(calls) == 2 and not worker.state()["busy"])
        self.assertEqual(calls[0][-2], ["Anong gagawin natin sa checkout?"])
        self.assertEqual(calls[1][-2], ["Per feature tayo.", "May rollback ba?"])
        self.assertEqual(calls[1][1], calls[0][-2])
        self.assertEqual(calls[1][-1][0]["title"], "Rollback")
        self.assertEqual(len(worker.state()["cards"]), 1)

    def test_stop_during_answer_discards_stale_card_and_opt_out_sends_nothing(self):
        started, release, finished = threading.Event(), threading.Event(), threading.Event()
        def respond(*args):
            started.set()
            release.wait(2)
            finished.set()
            return card()
        generate = Mock(side_effect=respond)
        worker = self.start_worker(generate)
        worker.heard(dict(id=1, text="Can we split checkout?"))
        self.assertTrue(started.wait(1))
        worker.stop(clear=True)
        worker.heard(dict(id=2, text="Private discussion"))
        release.set()
        self.assertTrue(finished.wait(1))
        worker.close()
        worker.worker.join(1)
        generate.assert_called_once()
        self.assertEqual(worker.state()["cards"], [])

    def test_skip_yields_no_card(self):
        generate = Mock(return_value=card("skip", ""))
        worker = self.start_worker(generate)
        worker.heard(dict(id=1, text="Just reading my notes."))
        until(lambda: generate.called and not worker.state()["busy"])
        self.assertEqual(worker.state()["cards"], [])

    def test_auto_correction_requires_a_real_source_line(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder)/"notes.md").write_text("Still calls the old repository.")
            def fake(args, **kwargs):
                if "status" in args:
                    return CompletedProcess(args, 0, "ChatGPT", "")
                self.assertNotIn("OPENAI_API_KEY", kwargs["env"])
                self.assertIn('forced_login_method="chatgpt"', args)
                self.assertIn('model_provider="openai"', args)
                data = dict(card("correction"), source=source, basis=basis)
                Path(args[args.index("--output-last-message") + 1]).write_text(json.dumps(data))
                return CompletedProcess(args, 0)
            with patch("assistant.shutil.which", return_value="codex"), patch.dict(os.environ, OPENAI_API_KEY="fixture"), patch("assistant.subprocess.run", side_effect=fake):
                for source, basis, kind in [("notes.md:1", "workspace", "correction"), ("notes.md:5", "workspace", "skip"),
                                            ("", "workspace", "skip"), ("", "general", "possible_correction")]:
                    result = answer("auto", [], [], folder, "", "sage", fresh=["All migrated?"])
                    self.assertEqual(result["kind"], kind)


class ModelChoiceTests(unittest.TestCase):
    def test_fast_prefers_lightweight_and_preserves_cli_default(self):
        catalog = ModelCatalog()
        models = [dict(id="full", name="Full", efforts=["medium"]), dict(id="test-mini",name="Mini",efforts=["low", "high"])]
        with patch("codex_models.shutil.which", return_value="codex"), patch("codex_models.discover", return_value=models) as discover:
            self.assertEqual(catalog.arguments("default"), [])
            self.assertEqual(catalog.arguments("fast"), ["--model", "test-mini", "-c", 'model_reasoning_effort="low"'])
            self.assertEqual(catalog.arguments("full"), ["--model", "full"])
            with self.assertRaisesRegex(ValueError, "unavailable"):
                catalog.arguments("unsupported")
            discover.assert_called_once()

    def test_missing_catalog_leaves_cli_default_available(self):
        with patch("codex_models.shutil.which", return_value=None):
            self.assertEqual(ModelCatalog().arguments("fast"), [])
