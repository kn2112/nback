# Dual N-Back

A minimal dual n-back trainer as an installable, offline-first PWA. Single user,
no accounts, no backend, no cloud sync — everything runs in the browser and is
stored on the device.

## Files

```
index.html          app shell (all views)
manifest.json       web app manifest (installable)
service-worker.js   precaches everything for offline use
css/style.css       light/dark theme, mobile-first layout
js/app.js           entry point: views, settings, history, theme, SW registration
js/play.js          game screen controller (grid, taps, keys, timing hooks)
js/game.js          pure logic: sequence generation, scoring, suggestions, round timer
js/audio.js         letter audio via SpeechSynthesis
js/storage.js       localStorage persistence (settings + history)
js/chart.js         hand-drawn canvas progress chart
js/reminders.js     optional daily reminder (Notifications API)
icons/              placeholder icons (192, 512, 512 maskable, 180 apple-touch)
serve.ps1           tiny static server for local testing (no Node/Python needed)
```

No build step. Serve the folder as static files.

## Run locally

Any static server works, for example:

```powershell
.\serve.ps1            # http://localhost:8080/
```

or `npx serve .` if you have Node. Service workers only register on `localhost`
or HTTPS, so open it via `http://localhost:8080/`, not `127.0.0.1`.

## Testing on a phone / installing

The game itself runs over plain HTTP on your LAN (`.\serve.ps1 -Lan`, see the
note in that file), but **offline caching and "Install" require HTTPS**. Options:

- Push the folder to any static host with HTTPS (GitHub Pages, Netlify, Cloudflare
  Pages, etc.) and open that URL on the phone. Relative paths mean it works from a
  sub-folder too.
- Android: `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080/` on
  the phone — that counts as a secure context.
- Or tunnel localhost over HTTPS (ngrok, cloudflared, localtunnel).

Then:

- **iPhone/iPad (Safari):** Share → Add to Home Screen. Notifications need iOS 16.4+
  and only work from the home-screen app.
- **Android (Chrome):** the Settings screen shows an "Install app" button, or use
  the browser menu → Install app / Add to Home screen.

## Game rules and scoring

- 3×3 grid; each trial one cell lights up and a letter from C H K L Q R S T is spoken.
- A round is 20 + n trials. From trial n+1 on, tap **Position** if the cell matches
  the one n trials ago, **Letter** if the letter matches. Keyboard: `A` / `L`.
- About 30% of scorable trials are matches per stream (6 of 20), placed at random.
- Accuracy per stream = hits ÷ (hits + misses + false alarms). Correct rejections are
  tracked but don't add points, so never tapping doesn't score well. Combined = mean
  of the two.
- After a round: combined ≥ 90% suggests n+1, < 50% suggests n−1. Suggestions are
  advisory; n never changes unless you accept.

## Settings

- Trial pace 1.5–4.0 s (default 2.5 s).
- Appearance: System / Light / Dark.
- Instant feedback (button colours) on/off.
- Daily reminder (off by default). Web apps can't schedule notifications while
  closed without a push server, so the reminder fires only when the app is open
  at the set time, or on the next open after that time on a day with no round.
  The Settings screen says this too.

## Updating the app

Cached files are served cache-first. After changing any file, bump `VERSION` in
`service-worker.js`; the next load shows an "Update available → Reload" toast.

## Replacing the icons

Drop in your own PNGs with the same names in `icons/` (192×192, 512×512, a
512×512 "maskable" version with ~20% safe padding, and 180×180 for iOS), then
bump the service worker version.

## Data

History lives in `localStorage` under `nback.history` (one record per completed
round: timestamp, n, pace, position/letter/combined accuracy, hit/miss counts).
Settings are under `nback.settings`. "Clear history" in Settings wipes the history.
