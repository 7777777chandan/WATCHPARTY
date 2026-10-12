# Changelog

- Step 0: design notes (folder layout, data model, event list, top risks) in docs/DESIGN.md
- Step 1: scaffolded server (Express + Socket.IO) and client (React + Vite), env files, /health, LAN access
- Step 2: rooms (6-char codes without 0/O/1/I), persistent userId identity, create/join/leave, invite links, 60 s disconnect grace
- Step 3: clock sync (8 pings, drop worst 25 %, median of the best half), re-sync every 20 s and on reconnect, debug panel (D), Vitest tests
- Step 4: synchronized YouTube player, server-authoritative playback with seq, echo-loop prevention (state comparison + command attribution + reconcile), seek detection, autoplay overlay
- Step 5: late-join snapshots, explicit rejoin after reconnects, connection-state recovery, duplicate-tab handover, 15 s host grace + auto transfer, reconnect banner, simulate-disconnect button
- Step 6: drift correction loop (moving average, soft rate / hard seek, cooldown, learned seek lead), drift ring-buffer log + download, drift reports, Sync Health panel (H), inject-drift buttons
- Step 7: per-room serial mutations, last-write-wins seq, 150 ms duplicate debounce, stale-action flag, host-only mode, chat toggle, room lock, host transfer, kick with 10 min ban
- Step 8: chat (validation, rate limit, history, linkify, safe rendering) and floating emoji reactions
- Step 9: shared playlist with oEmbed titles, votes, drag-and-drop reorder, play now / next, auto-advance on video end
- Step 10: polls (anonymous tallies, changeable votes, timers, tie-break), "Skip this video?" quick poll
- Step 11: TMDB proxy (categories, filters, search, trailers, cache, rate limit, timeouts), movies tab with Fuse.js fuzzy search, suggestion cards in chat
- Step 12: creative features: reaction timeline with replay, Catch me up, live sync dashboard, watch stats recap, spoiler-safe chat, synchronized countdown
- Step 13: design tokens with dark/light themes, responsive layout, unread badges, toasts, keyboard shortcuts, accessibility pass
- Step 14: load tester (mixed/burst/churn/chat, 10/15/30 clients) with PASS/FAIL tables and recorded test conditions
- Step 15: failure-handling tests (browser + server), 7 bugs found and fixed, docs/FAILURE_HANDLING.md
- Step 16: docs/REPORT.md with measured results (evidence in docs/evidence/), README demo script
- Step 17: review table produced (see the end-of-session summary); fixes pending approval
