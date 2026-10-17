/**
 * tests/harness/event_bus.js
 * In-memory IPC Event Bus simulating Electron ipcMain & ipcRenderer contracts.
 */
class IPCEventBus {
  constructor() {
    this._listeners = new Map();
    this._handlers = new Map();
    this._history = [];
  }

  // Subscribe to channel
  on(channel, listener) {
    if (!this._listeners.has(channel)) {
      this._listeners.set(channel, []);
    }
    this._listeners.get(channel).push(listener);
    return this;
  }

  // Unsubscribe
  removeListener(channel, listener) {
    if (!this._listeners.has(channel)) return this;
    const list = this._listeners.get(channel).filter(fn => fn !== listener);
    this._listeners.set(channel, list);
    return this;
  }

  // Register invoke handler
  handle(channel, handler) {
    if (this._handlers.has(channel)) {
      throw new Error(`Handler already registered for channel: ${channel}`);
    }
    this._handlers.set(channel, handler);
  }

  // Remove handler
  removeHandler(channel) {
    this._handlers.delete(channel);
  }

  // Invoke RPC handler
  async invoke(channel, ...args) {
    const handler = this._handlers.get(channel);
    if (!handler) {
      throw new Error(`No handler registered for '${channel}'`);
    }
    const start = performance.now();
    const result = await handler({ channel }, ...args);
    const duration = performance.now() - start;
    this._history.push({ type: 'invoke', channel, args, duration, timestamp: Date.now() });
    return result;
  }

  // Broadcast / send event
  send(channel, ...args) {
    const start = performance.now();
    const listeners = this._listeners.get(channel) || [];
    const event = { channel };
    for (const fn of listeners) {
      fn(event, ...args);
    }
    const duration = performance.now() - start;
    this._history.push({ type: 'send', channel, args, duration, timestamp: Date.now() });
  }

  getHistory(channel = null) {
    if (!channel) return [...this._history];
    return this._history.filter(h => h.channel === channel);
  }

  clearHistory() {
    this._history = [];
  }

  reset() {
    this._listeners.clear();
    this._handlers.clear();
    this._history = [];
  }
}

module.exports = { IPCEventBus };
