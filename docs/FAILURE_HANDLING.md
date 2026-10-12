# Failure handling

Every row was run automatically, and the "Actual" column is what the test observed.
- **Browser (B)**: `e2e/failure.e2e.mjs` (16 checks) and `e2e/sync.e2e.mjs` (24 checks), in real Chromium with a fake YouTube player.
- **Server (S)**: `server/test/*.test.js` (`npm test`, 29 tests), raw socket.io-client and HTTP.
- Grace periods are the real production values (60 s removal, 15 s host), except in `server/test/grace.test.js`, which shortens them via env vars.

Last run: 2026-10-12, Linux, Node v22.22.0, Chromium (Playwright 1.56), all on one machine.

| # | Scenario | Expected behaviour | Actual behaviour (what the user sees) | Test | Status |
|---|---|---|---|---|---|
| 1 | **Server restart mid-session** | Clients show "Reconnecting…". After the restart the room is gone (in-memory state), so they get a clear message and a way to start over. | Yellow "Reconnecting…" banner within 1 s. After the restart, both tabs show **"This room no longer exists"**, which explains the server may have restarted. **"Start a new room"** creates a room and joins it in one click. | B | ✅ |
| 2a | **Network drop 3 s** | Others see the user greyed out (not removed). On return: same identity, no "joined" spam, resynced. | Greyed out ("reconnecting…") in everyone's list. "Back online" banner on return. Positions matched within 60 ms. | B | ✅ |
| 2b | **Network drop 20 s (the host)** | Host keeps the crown for 15 s, then it passes to the longest-connected user. The old host returns as a guest. | Toast "You are now the host 👑" for Bob after 15 s. Alice returns as a guest and Bob keeps the crown. Positions matched within 70 ms. | B | ✅ |
| 2c | **Network drop 90 s** | After 60 s the user is removed ("left (connection lost)"). On return they rejoin automatically and resync. | Removed after exactly 60 s. On reconnect they rejoined as a member and resynced within 70 ms. | B | ✅ |
| 2d | Simulated 5 s disconnect during playback, plus a seek made while offline | Rejoin and apply the snapshot, including the missed seek. | Back at the room position within 40 ms. | B (sync) | ✅ |
| 3 | **Host leaves and returns inside / outside the grace window** | Inside 15 s: still host. Outside: transferred. | Inside: still host (5 s absence). Outside: see 2b. A refresh keeps host status (sync e2e). | B, S | ✅ |
| 4 | **30-user join/leave storm** | The server stays consistent: no duplicates, no ghosts, correct connected flags. | 30 sockets join. 15 leave, 8 drop abruptly, then all rejoin at once. The final list has exactly 31 unique, connected members. A 30-client load test also passed (see REPORT). | S | ✅ |
| 5a | Negative position, string position, NaN, 1e12, null, unknown `type` | Rejected with a clear error. No state change. | Each one rejected (`position must be >= 0`, `…finite number`, `type must be play, pause or seek`…). `/health` still OK. | S | ✅ |
| 5b | Non-object payloads (string, number, array, boolean), `__proto__` payloads | Rejected. No prototype pollution. | `Invalid payload` / `Unknown setting "__proto__"`. `{}.polluted` stays undefined. | S | ✅ |
| 5c | Wrong types in every feature (chat object, 5000-char text, 50 poll options, `javascript:` URL, `{ $ne: null }` ids, 9999 s countdown, `<img>` video id…) | Rejected. | All 15 cases rejected with a clear error. | S | ✅ |
| 5d | **1 MB chat message** | Rejected without hurting anyone else. | The frame exceeds `maxHttpBufferSize` (100 KB), so only that socket is closed. Other clients carry on (a new room could be created right after). The client also caps input at 500 characters. | S | ✅ |
| 5e | **Unknown emoji** | Rejected. | `Unsupported emoji`. | S | ✅ |
| 5f | **1000 events per second** | Server survives, drops the excess and disconnects the abuser. | Events beyond 50/s are dropped and `rate:limited` is sent. On the 3rd offending second, `abuse:disconnect` and the socket is closed. A fresh socket works normally. | S | ✅ |
| 5g | Event without an ack callback | The error still reaches the client. | Emitted as `action:error { event, error }` and shown as a toast. | S | ✅ |
| 6 | **YouTube video that can't be embedded or was removed** | Explain why. The host can skip. | Everyone sees "⚠️ The owner does not allow this video to be embedded." Guests see "The host can skip to another video". The host's **Skip to next** plays the next playlist item for everyone. Error codes 2, 5, 100, 101 and 150 each have their own text. | B | ✅ |
| 7a | **TMDB token missing** | Movies tab shows an error. The rest works. | 503 `Movie discovery is not configured…`. The tab shows "Movie discovery is unavailable" with Retry, and chat keeps working. | B, S | ✅ |
| 7b | TMDB rejects the token / unreachable / slower than 5 s | 503 with a clear message, no token leak, no hang. | 503 "rejected the server token" / "unreachable" / "timed out" (in under 6 s). The token never appears in responses or logs. | S | ✅ |
| 8 | **Two tabs of the same user** | The newest tab takes over. The old one explains and offers to take back. | Old tab: "You opened this room in another tab", with **Use this tab instead** and **Join as another person** (a separate per-tab identity, handy for testing). The server never shows the user twice. | B, S | ✅ |
| 9a | **Crashing React component** | One panel fails, not the whole app. | The per-panel error boundary shows "This panel crashed … Try again". The player and other tabs keep working, and retry recovers. A top-level boundary catches anything else (Reload/Home). | B | ✅ |
| 9b | `unhandledRejection` / `uncaughtException` on the server | Logged loudly. Never silent. | Both are logged with stack traces. The process keeps serving, because all rooms are in memory and exiting would end every party. A crash-loop guard exits after more than 5 uncaught exceptions in 60 s, so a supervisor can restart it. Startup errors (port in use) exit immediately. Room timers catch their own errors. | code review | ✅ |
| 10 | Stale or out-of-order `playback:state` | Ignored. | States with `seq <=` the last applied one are dropped. Load tests counted 0 out-of-order and 0 gaps. | S, load | ✅ |
| 11 | Autoplay blocked by the browser | Clear call to action instead of silent desync. | Overlay **"▶ Click to join playback"**. One click starts at the room position. | unit of logic, manual | ✅ (manual) |

## Known limitations surfaced by these tests

- **State is in memory.** A server restart ends every room (row 1). The UX makes recovery one click, but history, playlists and polls are lost.
- **Socket.IO connection-state recovery** only covers drops shorter than 2 minutes, and only while the server stays up. The explicit rejoin is what guarantees correctness.
- **Autoplay (row 11)** is browser-policy dependent and was only checked manually. The automated tests run with a fake player.
- **Real YouTube** could not be reached from the test environment. The fake player reproduces the API's documented behaviour (async events, BUFFERING→PLAYING, `seekTo` on a cued video starting playback, rate rounding), but a final manual check with real videos is required (see the README demo script).

## Bugs found and fixed by this testing

| Bug | Found by | Fix |
|---|---|---|
| A click right after a remote update was swallowed, so that tab played alone. | sync e2e | Replaced the blanket "ignore events" window with command attribution, plus reconcile. |
| Paused clients could disagree by up to 0.3 s. | sync e2e | Exact (0.05 s) alignment when paused. |
| A user seek within 0.8 s of a remote update was lost. | sync e2e | Programmatic seeks are recognised by their target, not by a time window. |
| TMDB search took 10 s when TMDB hung (genres fetched first). | S (timeout test) | Genres are fetched concurrently and treated as cosmetic. |
| A ghost member was left when one socket switched identity in the same room. | review + S | The old membership is released first. |
| A deferred `room:leave` from the previous room deleted the newly created room. | B (restart scenario) | `room:leave { code }`, ignored for other rooms. |
| `EADDRINUSE` left a zombie process after the keep-alive change. | running the tests | `server.on('error')` exits on startup failures. |
