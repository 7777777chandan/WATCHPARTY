import os from 'node:os';

/** Records the test conditions alongside every result file. */
export function testConditions({ url, clients, scenario, duration, actionInterval }) {
  const host = new URL(url).hostname;
  const local = ['localhost', '127.0.0.1', '::1'].includes(host);
  return {
    timestamp: new Date().toISOString(),
    node: process.version,
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCores: os.cpus().length,
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    clients,
    scenario,
    durationSec: duration,
    actionIntervalMs: actionInterval,
    serverUrl: url,
    sameMachine: local,
    network: local ? 'loopback (server and bots on the same machine)' : `remote host ${host}`,
    transport: 'websocket',
  };
}
