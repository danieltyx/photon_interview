# photon_interview

Recorded coding-interview app. Two rounds per candidate:

- **Round 1** — three questions, 10 min think + 2 min answer each, no retake. Camera + mic + screen all recorded as separate files.
- **Round 2** — same questions, take-home, open-ended, re-recordable until submit.

After each upload, webm is transcoded to mp4 in the background (ffmpeg). Admin dashboard at `/admin` (basic auth).

## Stack

Bun · vanilla HTML/JS · ffmpeg · Docker · Railway volume.

## Run locally

```bash
ADMIN_PASSWORD=changeme bun server.ts
```

Open `http://localhost:3000`. Localhost is treated as secure, so camera/screen prompts work.

## Deploy on Railway

1. Connect GitHub repo (Dockerfile is auto-detected via `railway.json`).
2. Attach a **Volume** mounted at `/data` (size depends on candidate count — ~1 GB per candidate is a safe estimate at default bitrates).
3. Set variables:
   - `ADMIN_PASSWORD` — login for `/admin`
   - `SUBMISSIONS_DIR=/data/submissions`
4. Generate a public domain. HTTPS is required for camera/screen capture in production.

## Layout

```
server.ts            Bun server: routes, uploads, transcode queue, admin
questions.json       The 3 prompts (edit to change interview content)
public/
  index.html / app.js        Round 1 (timed)
  round2.html / round2.js    Round 2 (take-home)
  admin.html / admin.js      Reviewer dashboard
  style.css
Dockerfile           Installs ffmpeg + Bun runtime
railway.json         Tells Railway to use the Dockerfile
```

Submissions land in `$SUBMISSIONS_DIR/<sessionId>/` with `meta.json`, `resume.<ext>`, and `round{1,2}/q{1..3}_{camera,screen}.{webm,mp4}`.
