// Networks of browsers over WebRTC, one per Trystero discovery strategy. Each finds
// peers through different public infrastructure (Nostr relays, BitTorrent trackers,
// MQTT brokers; no server of ours), so one being slow or rate-limited doesn't stop
// players from meeting. Data flows peer to peer either way.
// Trystero 0.25 API: handlers are assigned properties; message handlers get { peerId }.
import { RoomBase, networkOf } from './rooms.js';
import { loadVendor } from './vendor/vendor.js';

const STRATEGIES = ['nostr', 'torrent', 'mqtt'];
const VENDOR_EXPORT = { nostr: 'nostr', torrent: 'torrent', mqtt: 'mqttStrategy' }; // see vendor/p2p_entry.mjs
const ACTION = 'world';
const peerIdOf = who => (typeof who === 'string' ? who : who?.peerId);

class TrysteroRoom extends RoomBase {
  constructor(selfId, join) {
    super(selfId);
    this.join = join;
    this.connect();
  }

  connect() {
    this.room = this.join();
    this.action = this.room.makeAction(ACTION);
    this.room.onPeerJoin = who => this.onPeerJoin(peerIdOf(who));
    this.room.onPeerLeave = who => this.onPeerLeave(peerIdOf(who));
    this.action.onMessage = (data, from) => this.onMessage(new Uint8Array(data), peerIdOf(from));
  }

  // Joining announces us immediately; later announcements ride timers that hidden
  // tabs slow down. Rejoining an empty room announces again (see multi_network.js).
  refresh() {
    this.room.leave();
    this.connect();
  }

  peers() { return Object.keys(this.room.getPeers()); }

  send(bytes, to) {
    this.action.send(bytes, to === undefined ? {} : { target: to }).catch(() => {}); // peer may be gone
  }

  leave() { this.room.leave(); }
}

// One network per strategy that loads; strategies that fail to load are skipped.
// Outside browsers (load tests in Node) pass how to load a strategy and a WebRTC polyfill.
export async function trysteroNetworks(appId, { load = async name => (await loadVendor())[VENDOR_EXPORT[name]], rtcPolyfill } = {}) {
  const loaded = await Promise.allSettled(STRATEGIES.map(load));
  const config = rtcPolyfill ? { appId, rtcPolyfill } : { appId };
  const networks = loaded
    .filter(result => result.status === 'fulfilled')
    .map(({ value: { joinRoom, selfId } }) =>
      networkOf(name => new TrysteroRoom(selfId, () => joinRoom(config, name))));
  if (networks.length === 0) throw new Error('no Trystero strategy could be loaded');
  return networks;
}
