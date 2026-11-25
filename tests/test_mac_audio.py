import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from audio import BLOCK_FRAMES, MAC_SYSTEM_ID, Listener, outputs


class MacAudioTests(unittest.TestCase):
    def setUp(self):
        self.listener = Listener(MAC_SYSTEM_ID, 8080, Mock(), Mock(), Mock(), Mock())
        self.recorder = Mock()
        self.factory = Mock(return_value=self.recorder)
        module = SimpleNamespace(SystemAudioRecorder=self.factory)
        patcher = patch.dict("sys.modules", pysysaudio=module)
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("audio.platform.system", return_value="Darwin")
    @patch("audio.sys.version_info", (3, 11, 9))
    def test_devices_for_native_and_legacy_macs(self, _system):
        legacy = SimpleNamespace(id="blackhole", name="BlackHole 2ch")
        with patch("audio.soundcard_outputs", return_value=[legacy]):
            with patch("audio.platform.mac_ver", return_value=("14.2", (), "arm64")):
                self.assertEqual([d.id for d in outputs()], [MAC_SYSTEM_ID, "blackhole"])
            with patch("audio.platform.mac_ver", return_value=("14.1", (), "arm64")):
                self.assertEqual(outputs(), [legacy])
        with patch("audio.soundcard_outputs", side_effect=RuntimeError), \
             patch("audio.platform.mac_ver", return_value=("15.0", (), "arm64")):
            self.assertEqual([d.id for d in outputs()], [MAC_SYSTEM_ID])

    def test_native_pcm_is_framed_without_dropping_or_reordering_bytes(self):
        pcm = bytes(range(256)) * 50
        self.assertEqual(len(pcm), BLOCK_FRAMES * 4)
        self.recorder.stream.return_value = iter([pcm[:850], pcm[850:8000], pcm[8000:]])
        blocks = self.listener.mac_blocks()
        self.assertEqual(next(blocks), pcm[:6400])
        self.assertEqual(next(blocks), pcm[6400:])
        blocks.close()
        self.factory.assert_called_once_with(sample_rate=16000, channels=1, format="bytes", dtype="int16")
        self.recorder.start_recording.assert_called_once_with()
        self.recorder.stop_recording.assert_called_once_with()

    @patch("audio.platform.system", return_value="Darwin")
    def test_native_speech_and_pause_reach_transcription_queue(self, _system):
        speech = b"\x00\x20" * BLOCK_FRAMES
        pcm = speech + bytes(4 * len(speech))
        self.recorder.stream.return_value = iter([pcm[:2000], pcm[2000:]])
        self.listener.capture()
        self.assertEqual(self.listener.pending.get_nowait(), pcm)
        self.assertEqual(self.listener.on_level.call_count, 5)
        self.listener.on_error.assert_called_once_with("Mac system audio capture ended. Start listening again.")

    def test_stop_releases_silent_native_stream(self):
        started, stopped = threading.Event(), threading.Event()

        def silent_stream():
            started.set()
            if not stopped.wait(3):
                raise AssertionError("silent stream stayed open")
            return iter(())

        self.recorder.stream.side_effect = silent_stream
        self.recorder.stop_recording.side_effect = stopped.set
        worker = threading.Thread(target=lambda: list(self.listener.mac_blocks()), daemon=True)
        worker.start()
        self.assertTrue(started.wait(1))
        self.listener.stop()
        worker.join(1)
        self.assertFalse(worker.is_alive())
        self.recorder.stop_recording.assert_called_once_with()

    def test_permission_failure_is_actionable(self):
        self.recorder.start_recording.side_effect = RuntimeError("denied")
        with self.assertRaisesRegex(RuntimeError, "Screen & System Audio Recording"):
            list(self.listener.mac_blocks())
