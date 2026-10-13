// Network of tabs in one browser, over BroadcastChannel. For testing without internet.
import { RoomBase, networkOf } from './rooms.js';
import { every } from './ticker.js';

const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 6000;

class LocalRoom extends RoomBase {
  constructor(selfId, channelName) {
    super(selfId);
    this.lastHeard = new Map();
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = e => this.receive(e.data);
    this.stopHeartbeat = every(HEARTBEAT_MS, () => this.heartbeat());
    this.post('hello', null);
  }

  peers() { return [...this.lastHeard.keys()]; }

  send(bytes, to) { this.post('data', to ?? null, bytes); }

  leave() {
    this.post('bye', null);
    this.stopHeartbeat();
    this.channel.close();
  }

  post(kind, to, data) { this.channel.postMessage({ kind, from: this.selfId, to, data }); }

  receive({ kind, from, to, data }) {
    if (to !== null && to !== this.selfId) return;
    if (kind === 'bye') { this.forget(from); return; }

    if (!this.lastHeard.has(from)) {
      this.lastHeard.set(from, performance.now());
      this.post('hello', from); // so the newcomer learns about us too
      this.onPeerJoin(from);
    }
    this.lastHeard.set(from, performance.now());
    if (kind === 'data') this.onMessage(data, from);
  }

  forget(id) {
    if (this.lastHeard.delete(id)) this.onPeerLeave(id);
  }

  heartbeat() {
    this.post('hello', null);
    const now = performance.now();
    for (const [id, heard] of this.lastHeard) {
      if (now - heard > TIMEOUT_MS) this.forget(id);
    }
  }
}

export function localNetwork(appId) {
  const selfId = crypto.randomUUID();
  return networkOf(name => new LocalRoom(selfId, `${appId}:${name}`));
}
