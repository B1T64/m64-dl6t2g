// Networks of browsers over WebRTC, one per Trystero discovery strategy. Each finds
// peers through different public infrastructure (Nostr relays, BitTorrent trackers,
// MQTT brokers; no server of ours), so one being slow or rate-limited doesn't stop
// players from meeting. Data flows peer to peer either way.
// Trystero 0.25 API: handlers are assigned properties; message handlers get { peerId }.
import { RoomBase, networkOf } from './rooms.js';
import { loadVendor } from './vendor/vendor.js';
import { after } from './ticker.js';

const STRATEGIES = ['nostr', 'torrent', 'mqtt'];
const VENDOR_EXPORT = { nostr: 'nostr', torrent: 'torrent', mqtt: 'mqttStrategy' }; // see vendor/p2p_entry.mjs
const ACTION = 'world';
// Trystero 0.25 finishes leaving a room asynchronously: the same room joined again
// right away never hears anyone (measured in Chromium; a second later it's fine).
// So a room this page left a moment ago is rejoined only once that gap has passed.
const REJOIN_GAP_MS = 1500;
const peerIdOf = who => (typeof who === 'string' ? who : who?.peerId);

class TrysteroRoom extends RoomBase {
  constructor(selfId, join, leftAt) {
    super(selfId);
    this.join = join;
    this.leftAt = leftAt; // when this page last left this room on this network, or undefined
    this.room = null;     // until connected
    this.left = false;
    this.connectWhenSafe();
  }

  connectWhenSafe() {
    const wait = (this.leftAt.get() ?? -Infinity) + REJOIN_GAP_MS - Date.now();
    if (wait <= 0) { this.connect(); return; }
    this.cancelWait = after(wait, () => { this.cancelWait = null; this.connect(); });
  }

  connect() {
    this.room = this.join();
    this.action = this.room.makeAction(ACTION);
    this.room.onPeerJoin = who => this.onPeerJoin(peerIdOf(who));
    this.room.onPeerLeave = who => this.onPeerLeave(peerIdOf(who));
    this.action.onMessage = (data, from) => this.onMessage(new Uint8Array(data), peerIdOf(from));
    this.room.onPeerStream = (stream, from) => this.onPeerStream(stream, peerIdOf(from));
  }

  disconnect() {
    this.cancelWait?.();
    this.cancelWait = null;
    if (!this.room) return;
    this.room.leave();
    this.room = this.action = null;
    this.leftAt.set(Date.now());
  }

  // Joining announces us at once; later announcements ride timers that hidden tabs
  // slow down. Rejoining an empty room announces again (see multi_network.js).
  refresh() {
    if (this.left || !this.room) return; // still waiting to (re)join: nothing to refresh
    this.disconnect();
    this.connectWhenSafe();
  }

  peers() { return this.room ? Object.keys(this.room.getPeers()) : []; }

  send(bytes, to) {
    this.action?.send(bytes, to === undefined ? {} : { target: to }).catch(() => {}); // peer may be gone
  }

  // A stream still on the peer connection (left there by another room) is taken off and
  // put back, so this room's peer gets it
  addStream(stream, to) {
    if (!this.room) return;
    try {
      this.room.addStream(stream, to);
    } catch {
      try { this.room.removeStream(stream, to); this.room.addStream(stream, to); } catch {}
    }
  }
  removeStream(stream, to) { this.room?.removeStream(stream, to); }

  leave() {
    this.left = true;
    this.disconnect();
  }
}

// One network: rooms by name, remembering when each was last left
function trysteroNetwork(selfId, joinRoom) {
  const leftAt = new Map();
  return networkOf(name => new TrysteroRoom(selfId, () => joinRoom(name), {
    get: () => leftAt.get(name),
    set: time => leftAt.set(name, time),
  }));
}

// One network per strategy that loads; strategies that fail to load are skipped.
// Outside browsers (load tests in Node) pass how to load a strategy and a WebRTC polyfill.
export async function trysteroNetworks(appId, { load = async name => (await loadVendor())[VENDOR_EXPORT[name]], rtcPolyfill } = {}) {
  const loaded = await Promise.allSettled(STRATEGIES.map(load));
  const config = rtcPolyfill ? { appId, rtcPolyfill } : { appId };
  const networks = loaded
    .filter(result => result.status === 'fulfilled')
    .map(({ value: { joinRoom, selfId } }) => trysteroNetwork(selfId, name => joinRoom(config, name)));
  if (networks.length === 0) throw new Error('no Trystero strategy could be loaded');
  return networks;
}
