import 'dotenv/config';
import { createAppServer } from './app.js';
import { logger } from './utils/logger.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Never fail silently. All room state lives in memory, so exiting would end every party at
// once; every socket handler and room timer already catches its own errors, so anything
// reaching here is unexpected but almost always local to one request. We log it loudly and
// keep serving, but if exceptions keep coming (>5 per minute) we assume the process is in a
// bad state and exit with an error code so nodemon / a process manager restarts it cleanly.
const crashTimes = [];
process.on('unhandledRejection', (reason) => {
  logger.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('[process] uncaughtException', err);
  const now = Date.now();
  crashTimes.push(now);
  while (crashTimes.length && now - crashTimes[0] > 60_000) crashTimes.shift();
  if (crashTimes.length > 5) {
    logger.error('[process] too many uncaught exceptions in a minute, exiting');
    process.exit(1);
  }
});

const { server } = createAppServer({
  clientOrigin: CLIENT_ORIGIN,
  allowLan: process.env.ALLOW_LAN !== 'false',
});

// Startup failures (port in use, permission denied) are fatal: exit instead of idling.
server.on('error', (err) => {
  logger.error(`[server] cannot listen on port ${PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  logger.info(`[server] listening on http://localhost:${PORT} (client origin ${CLIENT_ORIGIN})`);
});
