# Mock Interview Link

Enter a company, position and job description, get a short link like
`mock-interview-link.vercel.app/i/stripe-7kq2`. Anyone who opens it on a phone sees a prep sheet
for that role, then joins a video-call style interview with Maya or Daniel: a hands-free voice
conversation (talk naturally, interrupt, get follow-ups) with questions drawn from the posting
and web research. Afterwards they're emailed a scorecard graded against a rubric that quotes
their own answers.

Built for the UGA Create Club challenge (Option E).

## How it works

| Step | What happens |
|---|---|
| Create (`/`) | `api/create` has Claude research the company and role on the web (search + fetch), then write a role rubric, a prep sheet, and N spoken questions that cover the rubric. The plan is saved under a short link (or packed into a long link if no database is connected). |
| Prep (`/i/<id>`) | Before starting, the candidate sees what the role looks for, how to prepare, interview tips, and the criteria they'll be graded on. |
| Interview (`/i`) | **Live mode** (needs `OPENAI_API_KEY`): `api/realtime` mints a short-lived key for an OpenAI Realtime session whose instructions hold the persona, the role, the research notes and the planned questions. The phone connects straight to OpenAI over WebRTC, so the conversation is hands-free with natural turn-taking. The model calls `set_question` as it moves through the plan and `end_interview` after saying goodbye; the page keeps a transcript from the live captions. **Classic mode** (fallback): the question is read aloud (`api/speak` or the browser voice), the candidate taps to answer (browser speech recognition, or typing), and `api/turn` decides on one follow-up. |
| Scorecard | `api/finish` grades against the **baseline rubric** (`lib/rubric.js`: communication, specific examples, ownership and impact, motivation and fit, self-awareness) and the **role rubric**, each criterion 1-5 with a word-for-word quote. Overall score out of 10 weighs the role rubric 60% and the baseline 40%. Also gives per-answer feedback, then emails the scorecard and shows it on screen. |

No app install: works in Safari on iPhone and Chrome on Android. Light and dark themes
(toggle in the top corner). Interviewer photos are stock images from Unsplash.

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

- `public/` the two pages (`index.html` create, `i.html` + `interview.js` interview), shared helpers (`ui.js`) and styles (`style.css`)
- `api/` serverless routes: `create`, `realtime`, `turn`, `finish`, `plan`, `speak`
- `lib/` Claude prompts and research (`claude.js`), baseline rubric and scoring (`rubric.js`), email (`email.js`), short-link store (`store.js`), interviewer personas and voices (`interviewers.js`), demo mode (`mock.js`)
