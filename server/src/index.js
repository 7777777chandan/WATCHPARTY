import 'dotenv/config';
import { createAppServer } from './app.js';
import { logger } from './utils/logger.js';

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// Never exit silently: log loudly. An uncaught exception leaves the process in an unknown
// state, so we log it and exit with an error code (nodemon / a process manager restarts it).
process.on('unhandledRejection', (reason) => {
  logger.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('[process] uncaughtException', err);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});

const { server } = createAppServer({
  clientOrigin: CLIENT_ORIGIN,
  allowLan: process.env.ALLOW_LAN !== 'false',
});

server.listen(PORT, () => {
  logger.info(`[server] listening on http://localhost:${PORT} (client origin ${CLIENT_ORIGIN})`);
});
