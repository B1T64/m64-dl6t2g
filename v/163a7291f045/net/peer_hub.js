// What the game sees of the network (Module.webTransport, used by web_transport_lib.js):
// numeric peer handles instead of ids, and a queue it drains once per tick.
// Senders that flood are throttled here, per original sender (see rate_limit.js).
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

    topology.onPeerJoined = id => this.push({ type: EVENT.PEER_JOINED, peer: this.handleFor(id) });
    topology.onPeerLeft = id => this.peerLeft(id);
    topology.onZoneMessage = (data, id) => this.message(data, id, () => this.handleFor(id));
    // relayed messages name a peer only when it's one the game can see (in my zone room)
    topology.onLevelMessage = (data, origin) => this.message(data, origin, () => this.visibleHandle(origin));
    topology.onWorldMessage = (data, origin) => this.message(data, origin, () => RELAYED_PEER);
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
