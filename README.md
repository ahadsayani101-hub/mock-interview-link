# Poise

*Practice out loud. Walk in ready.* (Repo name: Mock Interview Link.)

Enter a company, position and job description, get a short link like
`mock-interview-link.vercel.app/i/stripe-7kq2`. Anyone who opens it on a phone sees a prep sheet
for that role, then joins a video-call style interview with Maya or Daniel: a hands-free voice
conversation (talk naturally, interrupt, get follow-ups) with questions drawn from the posting
and web research. Afterwards they're emailed a scorecard graded against a rubric that quotes
their own answers.

Built for the UGA Create Club challenge (Option E).

**Free to run:** with only a free Google Gemini key (`GEMINI_API_KEY`, from
https://aistudio.google.com/apikey, no card needed) the app researches the company, writes the
questions and prep sheet, runs follow-ups, grades the interview, and gives the interviewer a
natural voice. Claude (`ANTHROPIC_API_KEY`) is used instead when its key is set. Note that Google
may use free-tier requests to improve its products. To stretch the free limits, building an
interview takes one AI request (the research brief is written in the same call), the same job
built again reuses its plan for 12 hours, follow-ups use the lighter models, and when a model's
free quota runs out the next free model takes over.

## How it works

| Step | What happens |
|---|---|
| Create (`/`) | `api/create` researches the company and role on the web, then writes a role rubric, a prep sheet, and N spoken questions that cover the rubric. With Claude, research uses its web search and fetch tools. With Gemini, `lib/web.js` searches DuckDuckGo (Bing as backup), reads the top pages, the company's Wikipedia article and recent Google News headlines, and Gemini writes a research brief from them (`lib/gemini.js`). The plan is saved under a short link (or packed into a long link if no database is connected). |
| Prep | Right after building, the same page shows the share link and a prep sheet (anyone opening the link lands here too), specific to the company and role: what they look for, their interview process, facts and news to know, stories to prepare, questions to ask them, tips, and the criteria they'll be graded on. The creator also sees the sources and the full research notes. |
| Interview (`/i`) | **Live mode** (needs `OPENAI_API_KEY`): `api/realtime` mints a short-lived key for an OpenAI Realtime session whose instructions hold the persona, the role, the research notes and the planned questions. The phone connects straight to OpenAI over WebRTC, so the conversation is hands-free with natural turn-taking. The model calls `set_question` as it moves through the plan and `end_interview` after saying goodbye; the page keeps a transcript from the live captions. **Classic mode** (fallback): the question is read aloud (`api/speak` with OpenAI, ElevenLabs or Gemini text-to-speech, or the browser voice), the candidate taps to answer, and `api/turn` decides on one follow-up. Answers are heard with the browser's speech recognition; where there is none (an iPhone app on the home screen, Firefox) the page records the answer as a small WAV file and `api/listen` has Gemini write it down. Typing is always available. |
| Scorecard | `api/finish` grades against the **baseline rubric** (`lib/rubric.js`: communication, specific examples, ownership and impact, motivation and fit, self-awareness) and the **role rubric**, each criterion 1-5 with a word-for-word quote. Overall score out of 10 weighs the role rubric 60% and the baseline 40%. Also gives per-answer feedback, then emails the scorecard and shows it on screen. |

**An app, for free.** Poise is a Progressive Web App, so there's no App Store fee: it has a
web app manifest (`public/manifest.webmanifest`), icons, and a service worker (`public/sw.js`)
that always loads fresh pages and only uses its saved copy offline (the API is never cached).
"Get the app" in the top bar (`public/install.js`) uses the browser's install prompt on Android
and desktop Chrome/Edge, and shows "Share, then Add to Home Screen" steps on iPhone. A short opening animation (the
logo pops in with two voice ripples, then the name) plays once per visit, or on each app launch;
tap to skip. Interviews
you build or take are listed under "Your interviews" with your last score, saved only on that
device. It also works in any phone browser with no install. Light and dark themes (toggle in
the top corner). Interviewer photos are stock images from Unsplash.

## Going public

- **Usage limits** (`lib/store.js`, `overLimit`): each API route caps calls per visitor per hour and for the whole site per day, so a shared link can't run up the bill. Limits are generous per visitor because a classroom on one Wi-Fi shares an address. They need the Upstash database; without it nothing is limited.
- Live calls end on their own after 25 minutes.
- Also set a monthly budget in the OpenAI and Anthropic dashboards as a hard stop. Gemini's free tier can't be charged; when its daily quota runs out, the voice falls back to the phone's and new interviews fail until the next day.
- Link previews use `public/og.png`; icons are `public/favicon.png`, `public/apple-touch-icon.png` and `public/icon-*.png` (the app icon).

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

- `public/` the whole app is one page (`index.html`): building and sharing in `app.js`, lobby, call and scorecard in `interview.js`, shared helpers in `ui.js`, styles in `style.css`. Share links (`/i/<id>`) open the same page at the lobby.
- `api/` serverless routes: `create`, `realtime`, `turn`, `finish`, `plan`, `speak`
- `lib/` prompts and research (`claude.js`, which uses Claude or hands off to `gemini.js`), free web research (`web.js`), baseline rubric and scoring (`rubric.js`), email (`email.js`), short-link store (`store.js`), interviewer personas and voices (`interviewers.js`), demo mode (`mock.js`)
