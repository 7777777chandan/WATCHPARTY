# Watch Party

Real-time watch party: synchronized YouTube playback, chat, reactions, playlists, polls and TMDB movie discovery.

## Prerequisites
- Node.js **20.19+** (Node 22 works too) and npm
- Git
- A TMDB account (API Read Access Token) for the Movies tab (optional; the rest works without it)

## Install
```bash
cd server && npm install
cd ../client && npm install
```

## Environment files
Create two `.env` files (copy the `.env.example` next to each):

`server/.env`
```
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
TMDB_READ_TOKEN=your_token_here
```

`client/.env`
```
VITE_SERVER_URL=http://localhost:3001
```

## Run (two terminals)
```bash
cd server && npm run dev     # http://localhost:3001  (GET /health)
cd client && npm run dev     # http://localhost:5173
```

### From a phone on the same Wi-Fi
Vite listens on all interfaces. Open `http://<your-LAN-IP>:5173` on the phone. The client talks to
`http://<your-LAN-IP>:3001` automatically, and the server accepts private-LAN origins by default
(set `ALLOW_LAN=false` in `server/.env` to disable this).
