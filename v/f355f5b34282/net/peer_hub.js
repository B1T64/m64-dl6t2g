// What the game sees of the network (Module.webTransport, used by web_transport_lib.js):
// numeric peer handles instead of ids, and a queue it drains once per tick.
// Senders that flood are throttled here, per original sender (see rate_limit.js).
// Players I block vanish from my game: no puppet, no chat, nothing they send reaches
// it (their world-wide progress still counts, like anyone's).
import { RateLimiter } from './rate_limit.js';

export const EVENT = { PEER_JOINED: 1, PEER_LEFT: 2, MESSAGE: 3 }; // mirrors WebTransportEventType
export const RELAYED_PEER = 0;                                      // mirrors WEB_TRANSPORT_RELAYED_PEER
const MAX_QUEUED_EVENTS = 4096;                                     // a paused game must not grow it forever

export class PeerHub {
  constructor(topology) {
    this.topology = topology;
    this.queue = [];
    this.handleById = new Map();
    this.idByHandle = new Map();
    this.nextHandle = RELAYED_PEER + 1;
    this.limiter = new RateLimiter();
    this.blocked = new Set();
    this.banned = new Set();      // kicked by the host (kicks.js): blocked, world news dropped too
    this.onLeaveWorld = () => {}; // this page was kicked
    this.hostId = null;            // the event's host, once its beacon is heard (host_beacon.js)
    this.onHostHandle = () => {};  // (handle): the game sends the host full-rate presence

    topology.onPeerJoined = id => this.peerJoined(id);
    topology.onPeerLeft = id => this.peerLeft(id);
    topology.onZoneMessage = (data, id) => { if (!this.blocked.has(id)) this.message(data, id, () => this.handleFor(id)); };
    // relayed messages name a peer only when it's one the game can see (in my zone room)
    topology.onLevelMessage = (data, origin) => { if (!this.blocked.has(origin)) this.message(data, origin, () => this.visibleHandle(origin)); };
    topology.onWorldMessage = (data, origin) => { if (!this.banned.has(origin)) this.message(data, origin, () => RELAYED_PEER); };
  }

  handleFor(id) {
    let handle = this.handleById.get(id);
    if (handle === undefined) {
      handle = this.nextHandle++;
      this.handleById.set(id, handle);
      this.idByHandle.set(handle, id);
    }
    return handle;
  }

  peerJoined(id) {
    if (this.blocked.has(id)) return;
    this.push({ type: EVENT.PEER_JOINED, peer: this.handleFor(id) });
    if (id === this.hostId) this.onHostHandle(this.handleFor(id));
  }

  setHost(id) {
    this.hostId = id;
    if (this.topology.isZonePeer(id)) this.onHostHandle(this.handleFor(id));
  }

  isBlocked(id) { return this.blocked.has(id); }

  block(id) {
    this.blocked.add(id);
    this.peerLeft(id);
  }

  isBanned(id) { return this.banned.has(id); }

  ban(id) {
    this.banned.add(id);
    this.block(id);
  }

  unban(id) {
    if (this.banned.delete(id)) this.unblock(id);
  }

  // Kicked: out of the shared world for good, playing alone from now on
  leaveWorld() {
    this.topology.leaveZone();
    this.topology.setZone = () => {};
    this.onLeaveWorld();
  }

  unblock(id) {
    if (this.banned.has(id)) return; // a kick isn't undone here
    if (this.blocked.delete(id) && this.topology.isZonePeer(id)) this.peerJoined(id);
  }

  // The game's handle for a roommate it draws, if any (voice.js asks how far they are)
  handleOf(id) { return this.handleById.get(id); }

  visibleHandle(id) {
    return this.topology.isZonePeer(id) ? this.handleFor(id) : RELAYED_PEER;
  }

  peerLeft(id) {
    const handle = this.handleById.get(id);
    if (handle === undefined) return;
    this.push({ type: EVENT.PEER_LEFT, peer: handle });
    this.handleById.delete(id);
    this.idByHandle.delete(handle);
  }

  message(data, sender, handle) {
    if (this.limiter.allow(sender)) this.push({ type: EVENT.MESSAGE, peer: handle(), data });
  }

  push(event) {
    if (this.queue.length >= MAX_QUEUED_EVENTS) this.queue.shift();
    this.queue.push(event);
  }

  // ---- the game's side ----
  poll() { return this.queue.shift() || null; }

  send(handle, data) {
    const id = this.idByHandle.get(handle);
    if (id !== undefined) this.topology.sendTo(id, data);
  }

  sendZone(data) { this.topology.sendZone(data); }
  sendLevel(data) { this.topology.sendLevel(data); }
  sendWorld(data) { this.topology.sendWorld(data); }
  setZone(name) { this.topology.setZone(name); }
  isRelay() { return this.topology.isDelegate; }
  isLevelSpokesman() { return this.topology.isLevelSpokesman; }
}
