# Mock Interview Link

Paste a job posting, get a link. Anyone who opens it on a phone is interviewed out loud with
questions drawn from that posting, gets probing follow-ups when an answer is thin, and is
emailed a scorecard that quotes their own answers.

Built for the UGA Create Club challenge (Option E).

## How it works

| Step | What happens |
|---|---|
| Create (`/`) | `api/create` asks Claude to read the posting and write N spoken questions, each tied to a requirement. The plan is saved for a short link (or packed into the link itself if no database is connected). |
| Interview (`/i`) | The phone reads each question aloud (browser text-to-speech) and transcribes the answer (browser speech recognition). After each answer `api/turn` decides whether to ask one follow-up or move on. |
| Scorecard | `api/finish` has Claude score each answer 1-5 with a word-for-word quote, a strength and a fix, then emails it and shows it on screen. |

No app install: works in Safari on iPhone and Chrome on Android. Browsers without speech
recognition fall back to typing.

## Run locally

```bash
npm install
cp .env.example .env   # fill in what you have; with nothing set it runs in demo mode
npm run dev            # http://localhost:3000
```

## Deploy (Vercel)

1. Import this repo at vercel.com/new (no build settings needed).
2. In Project Settings, then Environment Variables, add the keys from `.env.example`.
3. Optional but recommended for QR codes: Storage tab, then connect an Upstash Redis database.
4. Redeploy.

## Files

- `public/` the two pages (`index.html` create, `i.html` + `interview.js` interview)
- `api/` serverless routes: `create`, `turn`, `finish`, `plan`
- `lib/` Claude prompts (`claude.js`), email (`email.js`), short-link store (`store.js`), demo mode (`mock.js`)
