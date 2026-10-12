# Watch Party: Design (Prompt 0)

## (a) Folder structure

```
watch-party/
├── server/
│   ├── src/
│   │   ├── index.js            # Express + http + Socket.IO bootstrap
│   │   ├── config.js           # all tunables (limits, grace periods, rate limits)
│   │   ├── rooms/              # roomStore (Map), room factory, playback math, serializers
│   │   ├── handlers/           # one file per socket feature (room, time, playback, chat, ...)
│   │   ├── services/           # tmdb.js, youtube.js (oEmbed)
│   │   ├── routes/             # /api/movies router
│   │   └── utils/              # validation, rate limiting, ids, logging
│   └── test/                   # node:test unit + failure tests
├── client/
│   └── src/
│       ├── pages/              # Landing, Room
│       ├── components/         # Player, ChatPanel, PlaylistPanel, PollsPanel, MoviesPanel, ...
│       ├── hooks/              # useClockSync, useDriftCorrection, useRoom, ...
│       ├── context/            # SocketContext, ToastContext
│       ├── utils/              # clockSync, drift algorithm, youtube id parsing (pure, unit-tested)
│       └── styles/             # design tokens + global css
├── loadtest/                   # headless socket.io bots measuring latency/drift/correctness
└── docs/                       # EVENTS.md, REPORT.md, FAILURE_HANDLING.md, DESIGN.md
```

## (b) Data model (server, in memory)

| Entity | Fields |
|---|---|
| **Room** | `code` (6 chars, no 0/O/1/I), `hostId`, `createdAt`, `users: Map<userId, User>`, `playback: PlaybackState`, `settings {controlMode, chatEnabled, locked}`, `chat: ChatMessage[]` (≤200), `playlist {items: PlaylistItem[], currentItemId}`, `polls: Map<id, Poll>`, `reactions[]` (≤500, timestamped), `bans: Map<userId, until>`, `drift: Map<userId, report>`, `timers` (host grace, countdown, poll timers), `stats` |
| **User** | `userId` (nanoid, persisted in localStorage), `name` (1–24), `socketId` (current connection only), `connected`, `joinedAt`, `connectedSince`, `removalTimer` |
| **PlaybackState** | `videoId`, `playing`, `position` (s, valid at `updatedAt`), `updatedAt` (server ms), `seq` (monotonic), `lastActionBy` |
| **ChatMessage** | `id`, `type` (`user`/`system`/`suggestion`), `userId`, `name`, `text`, `ts`, optional `movie` card |
| **PlaylistItem** | `id`, `source` (`youtube`/`tmdb`), `videoId`, `title`, `thumbnail`, `addedBy`, `addedByName`, `addedAt`, `votes: Set<userId>` |
| **Poll** | `id`, `kind` (`normal`/`skip`), `question`, `options [{id, text, meta?}]`, `votes: Map<userId, {optionId, at}>`, `createdBy`, `createdAt`, `closesAt`, `status`, `allowChange`, `winnerId` |

Expected position: `playing ? position + (serverNow - updatedAt)/1000 : position`.

## (c) Socket events (draft; the full table is in EVENTS.md)

`time:ping`, `room:create`, `room:join`, `room:leave`, `room:users`, `room:host`, `room:settings`, `video:set`,
`playback:action`, `playback:state`, `drift:report`, `drift:update`, `chat:send`, `chat:message`,
`reaction:send`, `reaction:show`, `playlist:*`, `poll:*`, `host:transfer`, `user:kick`, `kicked`,
`session:replaced`, `countdown:start`, `countdown:show`, `stats:get`, `room:end`, `room:ended`.

## (d) Five riskiest problems

1. **Echo loops.** Applying a remote state makes the YouTube iframe fire `onStateChange`, which could be re-emitted as a new action.
   *Plan:* emit only transitions that differ from the latest *server* state, plus a short suppression window after each programmatic change and a reconcile step afterwards, so every client converges.
2. **Clock skew between devices.** Positions extrapolated with `updatedAt` are wrong if the device clocks differ.
   *Plan:* NTP-style offset estimation (8 pings, keep the low-RTT samples, take the median), with periodic re-sync and a re-sync on every reconnect.
3. **Drift and buffering.** Players stall, buffer, and run at slightly different speeds.
   *Plan:* a 1 s drift loop with a moving average, soft rate correction where the player supports fine rates, hard seeks for large drift, and a cooldown so it doesn't fight buffering.
4. **Reconnects, late joins and duplicate tabs.** A socket id is not an identity.
   *Plan:* a persistent `userId`, idempotent `room:join` that rebinds the socket, a 60 s removal grace, a 15 s host grace, `session:replaced` for duplicate tabs, and a full snapshot on every join.
5. **Concurrent conflicting actions and abuse.** Simultaneous play/pause/seek from many users, or malformed and flooding payloads.
   *Plan:* server-authoritative state with a monotonic `seq` (last write wins, clients drop stale seqs), duplicate debounce, validation on every payload, per-feature and per-socket rate limits, and disconnecting abusive sockets.
