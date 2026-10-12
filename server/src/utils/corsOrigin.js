/**
 * Builds a CORS origin checker.
 * Allows: every origin listed in CLIENT_ORIGIN (comma separated), and in development
 * any http origin whose host is localhost or a private LAN address (10.x, 192.168.x, 172.16-31.x),
 * so phones on the same Wi-Fi can connect without editing env files.
 */
const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)$/;

export function createOriginChecker(clientOrigin, allowLan = true) {
  const allowed = new Set(
    String(clientOrigin || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return (origin, callback) => {
    if (!origin || allowed.has('*') || allowed.has(origin)) return callback(null, true);
    if (allowLan) {
      try {
        const { hostname } = new URL(origin);
        if (PRIVATE_HOST.test(hostname)) return callback(null, true);
      } catch {
        /* fall through */
      }
    }
    return callback(null, false);
  };
}
