/**
 * Named timers owned by one room. set() replaces a timer with the same key, and
 * clearAll() runs when a room is deleted so no callback fires on a dead room.
 */
export class TimerBag {
  constructor() {
    this.timers = new Map();
  }

  set(key, fn, ms) {
    this.clear(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      fn();
    }, ms);
    this.timers.set(key, handle);
  }

  has(key) {
    return this.timers.has(key);
  }

  clear(key) {
    const handle = this.timers.get(key);
    if (handle) clearTimeout(handle);
    this.timers.delete(key);
  }

  clearAll() {
    for (const handle of this.timers.values()) clearTimeout(handle);
    this.timers.clear();
  }

  get size() {
    return this.timers.size;
  }
}
