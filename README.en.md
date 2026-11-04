# Listen Instant Ans

[![CI](https://github.com/Vist233/listen-instant-ans/actions/workflows/ci.yml/badge.svg)](https://github.com/Vist233/listen-instant-ans/actions/workflows/ci.yml)

[简体中文](README.md) | **English**

Listen Instant Ans is an open-source live classroom Q&A assistant: it transcribes a lecture from your microphone, and within seconds of the teacher asking a question it shows a concise answer (at most 100 Chinese characters). It ships as a macOS desktop app and a local browser app; everything runs on your own computer and your keys never leave it. The interface is in Chinese.

## At a glance

| Item | Details |
| --- | --- |
| What it does | Transcribes a lecture live, detects the teacher's questions, shows a key-points answer within seconds |
| Who it is for | Students and attendees who want to keep up with questions in class, lectures or meetings |
| Speech recognition | Aliyun Intelligent Speech Interaction (real-time, Chinese) |
| Answer generation | Xiaomi MiMo `mimo-v2.6-flash` (OpenAI-compatible API) |
| Platforms | macOS desktop app (Apple silicon and Intel); the browser app runs on any system with Node.js 24+ |
| Data location | All local: `~/.listen-instant-ans/`; audio is not stored |
| Cost | The software is free (MIT); MiMo and Aliyun bill you under their own terms |
| Tech stack | TypeScript, Node.js 24 (`node:sqlite`), Mastra, Electron, plain JS front end |

## FAQ

**What is it?** A locally run live Q&A tool for classes: it listens to the lecture and shows a key-points answer within seconds of each question.

**Does it need the internet or cost money?** It calls two cloud services: Aliyun Intelligent Speech Interaction (speech to text) and Xiaomi MiMo (answers). Each bills under its own terms. The software itself is free and open source.

**Where do audio and keys go?** Audio is sent only to Aliyun for recognition and is not stored. Keys are kept only in `~/.listen-instant-ans/settings.json` on your machine, and full keys are never shown in the page or logs.

**Does it support Windows or Linux?** The desktop app is macOS only for now. The browser app works on any system with Node.js 24+.

**How fast are answers?** A question is shown as soon as it is written. Two staggered lanes start a new request every 5 seconds, so answers usually appear within seconds; the exact time depends on the network and the model service.

**Are answers long?** No. Each answer is at most 100 characters and gives only the key points.

**Can it answer questions about current news or prices?** No. There is no search; the model will say it cannot verify.

**Why does macOS block the first launch?** The app has no paid Apple developer signature. Allow it once with the steps below.

**Can I use another model or speech service?** MiMo and Aliyun are built in. The code is split into modules (`apps/api/src/agent`, `apps/api/src/voice`), so you can extend it.

---

## Getting started

You need keys from two accounts (billed separately):

| Purpose | What you need |
| --- | --- |
| Answers | An API key from [MiMo](https://platform.xiaomimimo.com) |
| Speech to text | An AppKey and Token from Aliyun "Intelligent Speech Interaction" (the Token is temporary and expires; replace it in Settings) |

### Option 1: macOS desktop app (recommended)

1. Download the `.dmg` for your Mac from [Releases](https://github.com/Vist233/listen-instant-ans/releases) (`arm64` for Apple silicon, `x64` for Intel).
2. Open the `.dmg` and drag **Listen Instant Ans** into Applications.
3. **The first launch is blocked by macOS** because the app has no paid developer signature. To allow it:
   - open it once and dismiss the warning;
   - go to **System Settings → Privacy & Security**, find the "Listen Instant Ans was blocked" notice, and click **Open Anyway**;
   - or run in a terminal: `xattr -dr com.apple.quarantine "/Applications/Listen Instant Ans.app"`.
4. Enter your keys in the Settings dialog and save.
5. Allow microphone access when macOS asks, pick a microphone, and click the start-recording button.

### Option 2: browser app

Requires Node.js 24 or later.

```bash
git clone https://github.com/Vist233/listen-instant-ans.git
cd listen-instant-ans
npm install
npm start
```

Your browser opens http://localhost:3100. You can also download `listen-instant-ans-web-*.zip` from Releases, unzip it and run `node server.mjs --open` without `npm install`.

## Troubleshooting

- A volume meter sits next to the microphone while recording. If it stays silent for a few seconds the page warns you: check that the system is not muted and that you picked the right device.
- "No microphone permission": allow the app (or your browser) under **System Settings → Privacy & Security → Microphone**, then click re-detect.
- Sound but no text: the Aliyun Token has most likely expired; replace it in Settings.
- Text but no answers: check the MiMo API key. The status bar says which step was skipped and why.

## How it works

Two staggered lanes (A and B) each look at the latest transcript every 10 seconds, with B 5 seconds behind A, so a new request starts every 5 seconds. A question is shown as soon as it is written. Each lane's conversation is append-only so the model service's cache applies, and duplicate questions are dropped.

## Privacy and security

- Audio travels only between your computer and Aliyun and is **not stored**. Transcripts and Q&A are stored in `~/.listen-instant-ans/data.sqlite`.
- Keys live in `~/.listen-instant-ans/settings.json` (owner-readable only) and are never shown in full.
- The server listens only on `127.0.0.1` and rejects requests from other sites and host names.
- Uninstalling the app does not delete `~/.listen-instant-ans/`; remove it by hand if you want.

## Development

```bash
npm run check        # type check
npm test             # backend, web UI and desktop helper tests (offline)
npm run test:build   # build and verify the web and desktop apps (builds a .dmg on macOS)
npm run build:web    # -> dist/web
npm run build:desktop            # -> dist/desktop/*.dmg (add -- --arch=x64 for Intel)
```

Pushing a tag like `v0.1.0` makes GitHub Actions build the two `.dmg` files (arm64, x64) and the browser zip and publish them to Releases.

## Known limitations

- Only macOS has a desktop app; the browser app works anywhere with Node 24.
- The Aliyun Token must be renewed by hand.
- A rephrased duplicate question is occasionally answered once by each lane (the dedupe threshold is conservative on purpose).
- If the teacher repeats a question much later, the model may skip it as "already answered".
- No search: questions about current news or prices cannot be verified.

## License

[MIT](LICENSE)
