# Raphael

A local meeting assistant for the moment someone asks, *“Jhury, anong direction natin sa refactor?”* Listen to English and Tagalog from your computer’s playback device, connect a project folder, and get a short answer you can use while the conversation is still happening.

## Why Raphael?

In *That Time I Got Reincarnated as a Slime*, Rimuru can turn to Raphael, Lord of Wisdom, for analysis in the middle of a decision. That relationship inspired this project. During an architecture discussion, a tech lead may need thirty seconds to check a call site, recall a design decision, or find the right follow-up question. By then, the team has often moved on.

Raphael keeps the conversation and the checkout close together. When someone says “we already migrated all the queries,” **Check claim** can look for a counterexample. When someone asks what to do next, **Answer question** gives you a sentence you can say out loud. You choose what to share.

<p align="center">
  <a href="https://www.ten-sura.com/character/rimuru"><img src="https://www.ten-sura.com/4GfGdAp7/wp-content/themes/tensura_portal/assets/images/character/rimuru/character-image.png?v=6" alt="Rimuru Tempest, from the official TenSura character gallery" width="31%"></a>
  &emsp;
  <a href="https://elementalstory.com/collabo/tensura/"><img src="https://elementalstory.com/collabo/tensura/assets/images/common/index/img_raphael.png" alt="Rimuru in the Lord of Wisdom Raphael form, from the official Elemental Story collaboration" width="55%"></a>
</p>

*Rimuru Tempest and Raphael, Lord of Wisdom.* Character artwork is embedded from the official TenSura portal and StudioZ’s Elemental Story collaboration. Character and anime rights belong to their respective creators and rights holders, including Taiki Kawakami, Fuse, Kodansha, and the TenSura Production Committee. Raphael is an independent fan-inspired software project. The pixel avatars in the app are original.

## Try the workspace

Requires Python 3.10 or newer. From the repository root run:

```sh
python raphael.py
```

Open **Example session** to try a scripted Taglish refactoring discussion, answer cards, and a diagram. The example runs offline, with zero package installs or model downloads. **Settings** lets you try four personalities (Great Sage, Pair programmer, Reviewer, Coach), choose a pixel avatar, and enable topic-triggered suggestions. The dark, keyboard-friendly workspace takes visual inspiration from OpenCode and T3 Code.

## Use it in a real meeting

### 1. Connect Codex

Install the official Codex CLI. Run `codex login`, choose **Sign in with ChatGPT**, and check `codex login status`. In Raphael, use the pencil beside **Workspace** to enter the absolute path of a local checkout or folder. You can now type a question about it, even before connecting audio.

Raphael calls `codex exec` with an ephemeral, read-only session and asks for a structured answer. A source chip opens a local excerpt around the cited line. The selected personality changes the prompt for live answers. Calls draw on your plan’s Codex allowance. Select a folder you are comfortable making available to Codex. [Codex CLI](https://developers.openai.com/codex/cli/) · [Authentication](https://developers.openai.com/codex/auth/)

### 2. Live transcription

Install the audio dependencies inside a virtual environment:

```sh
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell uses .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Build or install **whisper-server** from whisper.cpp and download a multilingual model. Start it in a separate terminal. Substitute the actual binary and model paths on your machine:

```sh
whisper-server -m /path/to/ggml-small-q5_1.bin -l auto --host 127.0.0.1 --port 8080
```

Use the multilingual `small-q5_1` (181 MiB) or `base-q5_1` (57 MiB). English-only filenames contain `.en`. Model accuracy on mixed Taglish, names, and programming terms depends on the model, hardware and audio quality. [whisper.cpp server](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server) · [Multilingual model downloads](https://huggingface.co/ggerganov/whisper.cpp/tree/main)

| Platform | Playback setup |
| --- | --- |
| Windows | Route Meet to your headphones or speakers. Pick the matching WASAPI loopback device inside Raphael. |
| Linux | Use a PulseAudio server or PipeWire’s PulseAudio compatibility layer. Pick the monitor for the output playing the call. |
| macOS | Install BlackHole 2ch. In Audio MIDI Setup, create a Multi-Output Device containing your headphones and BlackHole. Route Meet to that output and select BlackHole in Raphael. Grant the recording app audio-input access if prompted. [BlackHole setup](https://github.com/ExistentialAudio/BlackHole) |

Start Raphael **from the activated environment**, open **Live workspace**, edit your watch topics, then choose **Start listening**. Let participants know before starting. The selected output includes other apps playing there. Your microphone is only included if you have explicitly routed it into that output.

### 3. Pick an action

| Control | Result |
| --- | --- |
| Answer question | A speakable reply to the latest outstanding question in the recent transcript. |
| Check claim | An evidence-based finding or an explanation of what could be verified. |
| Explain / Insight | A short explanation or one tradeoff worth raising. |
| Diagram | A compact, linear flow with up to five nodes. |
| Ask about this session | A custom question grounded in the selected folder and recent conversation. |

Turn on automatic insights in Settings for a response to matching terms in new speech. This is a simple local keyword filter with a one-minute cooldown. The example session always uses scripted replies.

## Where the data goes

- Playback audio is segmented in memory and sent to whisper.cpp on loopback. Raphael writes no audio recordings. Current speech may be discarded when you stop capture.
- The server retains up to 180 transcript segments in memory. A new session clears them. Recent cards live in the browser tab. Closing the Python process stops capture and clears the server transcript.
- Manual answers and opted-in suggestions send up to 12 recent transcript segments, topics, and your question to Codex. Codex can read the selected workspace and use relevant file content in the request.
- Avatar, personality, topics, folder path, and the automatic-suggestions preference are saved in this browser’s local storage.

## Development

The local Python service serves the interface on `127.0.0.1:8765`. The frontend uses plain HTML, CSS, and JavaScript. The speech worker waits for pauses or a ten-second limit before submitting an utterance. A bounded queue reports skipped audio if the model falls behind.

```sh
python -m unittest discover -s tests -v
python raphael.py --no-browser --port 8765 --whisper-port 8080
```

The tests use synthetic audio and simulated Codex output. To check a new machine, play a short, consented recording containing English, Tagalog, and a repo-specific identifier, confirm the transcript, then check a claim with a known file and line.
