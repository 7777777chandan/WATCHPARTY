import { SYNC } from './syncConfig.js';

/** Fixed-size ring buffer of drift checks and corrections, exportable as JSON evidence. */
export function createRingBuffer(size = SYNC.DRIFT_LOG_SIZE) {
  const buf = new Array(size);
  let start = 0;
  let count = 0;
  return {
    push(entry) {
      buf[(start + count) % size] = entry;
      if (count < size) count += 1;
      else start = (start + 1) % size;
    },
    toArray() {
      const out = [];
      for (let i = 0; i < count; i++) out.push(buf[(start + i) % size]);
      return out;
    },
    clear() {
      start = 0;
      count = 0;
    },
    get length() {
      return count;
    },
  };
}

export const driftLog = createRingBuffer();

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
