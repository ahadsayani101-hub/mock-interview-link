# Mock Interview Link

Enter a company, position and job description, get a short link like
`mock-interview-link.vercel.app/i/stripe-7kq2`. Anyone who opens it on a phone sees a prep sheet
for that role, is interviewed out loud with questions drawn from the posting and web research,
gets probing follow-ups when an answer is thin, and is emailed a scorecard graded against a
rubric that quotes their own answers.

Built for the UGA Create Club challenge (Option E).

## How it works

| Step | What happens |
|---|---|
| Create (`/`) | `api/create` has Claude research the company and role on the web (search + fetch), then write a role rubric, a prep sheet, and N spoken questions that cover the rubric. The plan is saved under a short link (or packed into a long link if no database is connected). |
| Prep (`/i/<id>`) | Before starting, the candidate sees what the role looks for, how to prepare, interview tips, and the criteria they'll be graded on. |
| Interview (`/i`) | The phone reads each question aloud in a natural AI voice (`api/speak`, OpenAI or ElevenLabs, falling back to the browser's voice) and transcribes the answer (browser speech recognition). After each answer `api/turn` decides whether to ask one follow-up or move on. |
| Scorecard | `api/finish` grades against the **baseline rubric** (`lib/rubric.js`: communication, specific examples, ownership and impact, motivation and fit, self-awareness) and the **role rubric**, each criterion 1-5 with a word-for-word quote. Overall score out of 10 weighs the role rubric 60% and the baseline 40%. Also gives per-answer feedback, then emails the scorecard and shows it on screen. |

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
3. For short links: Storage tab, then connect an Upstash Redis database (free).
4. Redeploy.

## Files

- `public/` the two pages (`index.html` create, `i.html` + `interview.js` interview)
- `api/` serverless routes: `create`, `turn`, `finish`, `plan`, `speak`
- `lib/` Claude prompts and research (`claude.js`), baseline rubric and scoring (`rubric.js`), email (`email.js`), short-link store (`store.js`), demo mode (`mock.js`)
