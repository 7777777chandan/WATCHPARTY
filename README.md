# 🍿 Watch Party

Watch YouTube together in sync. Rooms with invite links, synchronized play/pause/seek with automatic drift correction, live chat, floating emoji reactions pinned to the video timeline, a shared voting playlist, group polls, TMDB movie discovery with typo-tolerant search, host controls, and a synchronized countdown.

## Website

[Watch Party](https://watchparty-client-mocha.vercel.app)


**📄 Full report: [docs/REPORT.md](docs/REPORT.md)**: architecture, sync algorithms, measured latency and drift, failure handling, limitations.
Other docs: [socket events](docs/EVENTS.md) · [failure handling](docs/FAILURE_HANDLING.md) · [design notes](docs/DESIGN.md) · [changelog](CHANGELOG.md)

## Prerequisites
- **Node.js 20.19+** (Vite 8 needs it; Node 22 works) and npm
- Git
- Optional: a [TMDB](https://www.themoviedb.org/settings/api) **API Read Access Token** for the Movies tab. Everything else works without it.

## Install
```bash
cd server && npm install
cd ../client && npm install
```

## Environment files
Copy each `.env.example` to `.env`:

`server/.env`
```
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
TMDB_READ_TOKEN=your_token_here      # the long "API Read Access Token", not the short API key
```
`client/.env`
```
VITE_SERVER_URL=http://localhost:3001
```
The TMDB token is only read by the server. The browser never sees it.

## Run (two terminals)
```bash
cd server && npm run dev      # http://localhost:3001  (GET /health)
cd client && npm run dev      # http://localhost:5173
```
Production-style: `cd client && npm run build` (output in `client/dist`) and `cd server && npm start`.

### From a phone on the same Wi-Fi
1. Find your computer's LAN IP (macOS: `ipconfig getifaddr en0`; Windows: `ipconfig`; Linux: `hostname -I`).
2. On the phone, open `http://<LAN-IP>:5173`. Vite listens on all interfaces, the client automatically talks to `http://<LAN-IP>:3001`, and the server accepts private-network origins (set `ALLOW_LAN=false` to turn that off).
3. If it doesn't load, allow Node through your OS firewall for ports 5173 and 3001.

### Testing with two users on one computer
Each browser profile is one person (the identity lives in localStorage). Use a normal window plus a private window, or two browser profiles. If you open the same room twice in one profile, the old tab offers **Join as another person**, which gives that tab its own identity.

## Tests
| What | Command | Notes |
|---|---|---|
| Server unit + integration (29) | `cd server && npm test` | rooms, playback, grace periods, chat, polls, playlist, abuse, TMDB failures |
| Client unit (37) | `cd client && npm test` | clock offset maths, drift decisions, URL parsing, fuzzy search |
| Browser sync e2e (24) | `cd e2e && npm install && npm test` | needs server + client running. Uses a fake YouTube player |
| Browser failure e2e (16) | `cd e2e && npm run test:failure` | starts its own server on :3001 (stop yours first). About 4 minutes |
| Responsive / a11y (9) | `cd e2e && node screens.e2e.mjs` | screenshots at 360/768/1440 px into `e2e/screens/` |
| Load + latency | `cd loadtest && npm install && npm run test:all` | needs the server running. About 9 minutes. Results in `loadtest/results/` |

Individual load scenarios: `npm run test:mixed | test:burst | test:churn | test:chat | test:scale10 | test:scale30 | test:fine`, or
`node run.js --url http://<server>:3001 --clients 15 --duration 120 --actionInterval 3000 --scenario mixed`.
For a "same Wi-Fi" measurement, run the load test from a second laptop and point `--url` at the server's LAN IP.

## Keyboard shortcuts (in a room)
`Space` play/pause · `M` mute · `R` reactions · `D` debug panel (clock offset, inject drift, simulate disconnect, download drift log) · `H` sync health · `?` help

## 3-minute demo script
Prep: server and client running. Window A (normal) and window B (private), side by side. A phone on the same Wi-Fi is a bonus.

1. **0:00 Rooms.** In A, enter "Alice" and **Create a room**. Click **Copy invite link**, paste it in B, enter "Bob". Open the 👥 tab: Alice has the 👑 and both are online.
2. **0:20 Sync.** In A, paste a YouTube link and **Play now**. Press play in B: A starts too. Pause in A, seek in B: the other window follows within a blink. Press **H** to show Sync Health (drift in ms, green under 150).
3. **0:50 Drift correction.** In B press **D**, then **Inject drift (+3 s)**. Within about 2 s the player jumps back (hard seek). Show **Download drift log** as evidence. Mention soft correction (1.05×) for small drift.
4. **1:10 Social.** Click 🔥 and 😂 a few times: they float up on both screens and appear as markers on the reaction timeline. Send a chat message, then one starting with `||` (spoiler, blurred until clicked). Paste `<script>alert(1)</script>`: it shows as plain text.
5. **1:35 Decide together.** Playlist: add two links in B, vote with ▲, and as the host drag to reorder. Polls: **Skip this video?** Two yes votes skip to the next item for everyone. Movies: search `inceptoin` (typo), open it, **Suggest to room** (a card in chat), **Add trailer to playlist**.
6. **2:15 Host powers.** 👥 tab: tick **Only the host controls playback**, then try to pause in B (blocked with a lock badge). Click **⏱ Countdown**: both windows count 10…1 in lockstep and start together. Open **📈 Sync dashboard** (live sparklines).
7. **2:40 Reliability.** In B, Debug → **Simulate disconnect**: "Reconnecting…", then "Back online", and B lands at the right spot. Refresh A: still Alice, still host. Finish with **📊 Watch stats** (most reacted moment, top chatter).

## Project layout
```
server/    Express + Socket.IO (in-memory rooms), TMDB proxy        → npm run dev
client/    React + Vite, YouTube IFrame player                      → npm run dev
loadtest/  socket.io bots: latency, drift, correctness              → npm run test:all
e2e/       Playwright browser tests with a fake YouTube player       → npm test
docs/      REPORT, EVENTS, FAILURE_HANDLING, DESIGN
```
