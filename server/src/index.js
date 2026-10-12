import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createOriginChecker } from './utils/corsOrigin.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();
const corsOrigin = createOriginChecker(CLIENT_ORIGIN, process.env.ALLOW_LAN !== 'false');
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

io.on('connection', (socket) => {
  console.log(`[socket] connected ${socket.id}`);
  socket.on('disconnect', (reason) => console.log(`[socket] disconnected ${socket.id} (${reason})`));
});

server.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
