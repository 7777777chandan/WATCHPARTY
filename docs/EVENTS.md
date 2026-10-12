# Socket events

Conventions
- **C→S** = client to server, **S→C** = server to client.
- Requests that take an ack callback reply `{ ok: true, ... }` or `{ ok: false, error, code? }`.
  Without an ack, a failure is sent back as `action:error { event, error }`.
- Every C→S payload must be a plain object (or omitted). Anything else gets `Invalid payload`.
- Global per-socket budget: **50 events/s**. Extra events are dropped and `rate:limited` is sent.
  The third offending second within 10 s gets `abuse:disconnect` and the socket is disconnected.
  Frames over **100 KB** close the socket (Socket.IO `maxHttpBufferSize`).
- Identity is the persistent `userId` (client localStorage), never the socket id.

## Connection, clock and rooms

| Event | Direction | Payload | Description |
|---|---|---|---|
| `time:ping` | C→S (ack) | `{ t0 }` → ack `{ t0, ts }` | Clock sync. Server replies with `Date.now()` immediately. |
| `room:create` | C→S (ack) | `{ name (1–24), userId }` → `{ ok, code, room: Snapshot }` | Creates a room. The creator becomes host. Leaves any previous room. |
| `room:join` | C→S (ack) | `{ code (6), name, userId }` → `{ ok, code, room: Snapshot, rejoined }` | Joins, or **rejoins** (same userId rebinds the socket and keeps host status, with no join message). Errors: `ROOM_NOT_FOUND`, `BANNED`, `LOCKED`, `FULL` (>50). |
| `room:leave` | C→S (ack) | `{ code? }` | Leaves immediately (ignored if `code` is given and the socket is in a different room). Host leaving transfers host. An empty room is deleted. |
| `room:users` | S→C | `[{ userId, name, isHost, connected }]` | Broadcast on every membership or connection change. |
| `room:host` | S→C | `{ hostId, name, reason }` | Host changed (`transfer`, `host-left`, `host-timeout`). |
| `room:settings` | C→S (ack) host | `{ controlMode?: 'everyone'\|'host-only', chatEnabled?: bool, locked?: bool }` | Partial settings update. |
| `room:settings` | S→C | `{ controlMode, chatEnabled, locked }` | Broadcast after a change. |
| `host:transfer` | C→S (ack) host | `{ toUserId }` | Makes a connected member the host. Broadcasts `room:host`. |
| `user:kick` | C→S (ack) host | `{ userId }` | Removes the member. Their socket gets `kicked`, and their userId can't rejoin for 10 minutes. |
| `session:replaced` | S→C | `{ code }` | This userId joined from another tab. This socket is then disconnected. |
| `kicked` | S→C | `{ code, by, banMinutes }` | You were kicked (rejoin blocked for 10 min). |
| `room:end` | C→S (ack) host | – → `{ ok, recap }` | Ends the party for everyone and deletes the room. |
| `room:ended` | S→C | `{ recap, by }` | The host ended the room. Shows the recap. |
| `action:error` | S→C | `{ event, error }` | Failure of a request that had no ack callback. |
| `rate:limited` | S→C | `{ limit, strikes }` | Per-socket event budget exceeded. |
| `abuse:disconnect` | S→C | `{ reason }` | Sent right before an abusive socket is disconnected. |

**Snapshot** (join ack): `{ code, hostId, you, createdAt, users, settings, playback, chat (last 50), playlist, polls, reactions, countdown, serverTime }`.
The join also emits `playback:state` (with `snapshot: true`) to the joining socket only.

## Playback

| Event | Direction | Payload | Description |
|---|---|---|---|
| `video:set` | C→S (ack) host | `{ videoId (11 chars) }` | Sets the room video: position 0, paused, `seq++`. |
| `playback:action` | C→S (ack) | `{ type: 'play'\|'pause'\|'seek', position ≥ 0, clientSeq?, sentAt? }` → `{ ok, seq, deduped? }` | Changes playback. Rejected in host-only mode for guests (`HOST_ONLY_MODE`). An identical action from the same user within 150 ms is deduped. |
| `playback:state` | S→C | `{ videoId, playing, position, updatedAt, seq, by, byName, serverTime, action?, stale?, sentAt?, countdown?, snapshot? }` | Authoritative state, broadcast to everyone including the sender. `stale: true` when the sender's `clientSeq` was more than 5 behind. `sentAt` is echoed for latency measurement. |
| `playback:get` | C→S (ack) | – → `{ ok, state }` | Fetches the current state. |
| `drift:report` | C→S (ack) | `{ drift (ms), corrections, rtt? (ms), state? }` | Client's smoothed drift. Rate limited to 3 per 5 s per user. |
| `drift:update` | S→C | `[{ userId, name, drift, corrections, rtt, state, at }]` | Broadcast every 5 s (reports newer than 15 s, connected users only). |
| `countdown:start` | C→S (ack) host | `{ seconds (3–10) }` → `{ ok, startAt }` | Pauses at the current position, then starts playback at `startAt` (server ms). |
| `countdown:show` | S→C | `{ startAt, seconds, position, by, seq }` | Everyone renders `ceil((startAt − serverNow) / 1000)`. |
| `countdown:cancel` | C→S (ack) host / S→C | – | Cancels. Any manual playback action also cancels a countdown. |

## Chat and reactions

| Event | Direction | Payload | Description |
|---|---|---|---|
| `chat:send` | C→S (ack) | `{ text (1–500 after trim, control chars stripped) }` | Rate limit 5 per 5 s per user (`RATE_LIMITED`). Blocked when chat is disabled (except for the host). |
| `chat:suggest` | C→S (ack) | `{ movie: { id, title, posterUrl?, year?, rating? } }` | Posts a movie suggestion card. Poster must be an `image.tmdb.org` URL. Shares the chat rate limit. |
| `chat:message` | S→C | `{ id, type: 'user'\|'system'\|'suggestion', userId, name, text, ts, movie? }` | Last 200 kept, last 50 in the snapshot. |
| `reaction:send` | C→S (ack) | `{ emoji ∈ 😂 ❤️ 😮 👏 🔥 😢 👍 🎉 }` | Rate limit 5 per second per user. |
| `reaction:show` | S→C | `{ id, userId, name, emoji, videoId, videoTime, ts }` | `videoTime` is the room's expected position. Stored (cap 500) for the timeline. |

## Playlist

| Event | Direction | Payload | Description |
|---|---|---|---|
| `playlist:add` | C→S (ack) | `{ url \| videoId, title?, source?: 'youtube'\|'tmdb' }` | Anyone can add. Max 50, no duplicate videoIds. Title from YouTube oEmbed (3 s timeout), with a fallback. |
| `playlist:vote` | C→S (ack) | `{ itemId }` → `{ ok, voted }` | Toggles your vote. |
| `playlist:remove` | C→S (ack) | `{ itemId }` | Host, or the person who added the item. |
| `playlist:reorder` | C→S (ack) host | `{ itemId, newIndex }` | Moves an item. |
| `playlist:sortByVotes` | C→S (ack) host | – | Stable sort by vote count. |
| `playlist:playNow` | C→S (ack) host | `{ itemId }` | Plays the item for everyone (autoplay). |
| `playlist:next` | C→S (ack) host | `{ seq? }` | Plays the next item. The host's client sends it on ENDED with the seq it saw. A mismatched seq is ignored (duplicate protection). |
| `playlist:update` | S→C | `{ currentItemId, items: [{ id, source, videoId, title, thumbnail, addedBy, addedByName, addedAt, votes, voters }] }` | Full list after every change. Also in the snapshot. |

## Polls

| Event | Direction | Payload | Description |
|---|---|---|---|
| `poll:create` | C→S (ack) | `{ question (1–120), options: 2–5 × (string \| { text, meta?: { videoId?, tmdbId? } }), durationSec? (15–600) }` | Max 1 open poll per user and 3 per room. Timed polls auto-close. |
| `poll:createSkip` | C→S (ack) | – | Quick "Skip this video?" Yes/No poll, 30 s. Closes early when decided. A Yes majority of connected users plays the next playlist item. |
| `poll:vote` | C→S (ack) | `{ pollId, optionId }` | One vote per user, changeable while open. |
| `poll:close` | C→S (ack) | `{ pollId }` | Creator or host. |
| `poll:update` | S→C (per user) | `{ id, kind, question, options: [{ id, text, meta, votes }], totalVotes, createdBy, createdByName, createdAt, closesAt, status, allowChange, winnerId, closedReason, myVote }` | Anonymous tallies. `myVote` is filled in per recipient. Winner = most votes, and ties go to the option whose earliest vote came first. |

## Stats

| Event | Direction | Payload | Description |
|---|---|---|---|
| `stats:get` | C→S (ack) | – → `{ ok, recap }` | `recap = { watchTimeSec, videosPlayed, reactionCount, mostReacted: { videoId, time, count, topEmoji }, chatCount, topChatter, polls, durationSec, peopleNow, peopleTotal }` |

## HTTP

| Route | Description |
|---|---|
| `GET /health` | `{ status: 'ok', uptime, rooms }` |
| `GET /api/movies/categories` | `{ categories: [{ id, label }], genres: [{ id, label }] }` |
| `GET /api/movies?category&genre&year&minRating&page` | `{ page, totalPages, results: [{ id, title, overview, posterUrl, year, rating, genres }] }` |
| `GET /api/movies/search?q=&page=` | Same shape. |
| `GET /api/movies/:id/trailer` | `{ trailer: { key, name } \| null }` |

Movie routes: 60 requests/min per IP (429), 10 min cache, 5 s TMDB timeout. A missing or invalid token returns **503** with a JSON error.
