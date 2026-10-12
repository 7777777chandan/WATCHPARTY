import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createOriginChecker } from './utils/corsOrigin.js';
import { registerHandlers } from './handlers/index.js';
import { startDriftBroadcaster } from './handlers/driftHandlers.js';
import { setIo } from './rooms/notify.js';
import { roomCount } from './rooms/roomStore.js';
import { pruneLimiters } from './utils/limiters.js';
import { createMoviesRouter } from './routes/movies.js';
import { logger } from './utils/logger.js';

/** Builds the HTTP + Socket.IO server without listening (tests start it on a random port). */
export function createAppServer({ clientOrigin, allowLan = true } = {}) {
  const corsOrigin = createOriginChecker(clientOrigin, allowLan);
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), rooms: roomCount() });
  });
  app.use('/api/movies', createMoviesRouter());
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error('[http]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: corsOrigin },
    // Oversized frames (e.g. a 1 MB chat message) are rejected by closing that socket.
    maxHttpBufferSize: 100 * 1024,
    // Compression costs CPU and latency for tiny JSON frames; keep it off.
    perMessageDeflate: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: config.RECOVERY_MAX_DISCONNECT_MS,
      skipMiddlewares: true,
    },
  });
  setIo(io);

  io.on('connection', (socket) => {
    logger.debug(`[socket] connected ${socket.id}${socket.recovered ? ' (recovered)' : ''}`);
    registerHandlers(socket);
  });

  const stopDrift = startDriftBroadcaster();
  const pruneTimer = setInterval(pruneLimiters, 60_000);
  pruneTimer.unref();

  const close = () =>
    new Promise((resolve) => {
      stopDrift();
      clearInterval(pruneTimer);
      io.close(() => resolve());
    });

  return { app, server, io, close };
}
