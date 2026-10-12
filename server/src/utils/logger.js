const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const current = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const write = (level, args) => {
  if (LEVELS[level] < current) return;
  const line = [`${new Date().toISOString()} ${level.toUpperCase()}`, ...args];
  (level === 'error' || level === 'warn' ? console.error : console.log)(...line);
};

export const logger = {
  debug: (...a) => write('debug', a),
  info: (...a) => write('info', a),
  warn: (...a) => write('warn', a),
  error: (...a) => write('error', a),
};
