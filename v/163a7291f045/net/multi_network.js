// Several networks as one. They must share player ids (Trystero's strategies do):
// a peer reached through any of them is a peer, and it leaves only when none reaches
// it anymore. Each message takes a single route, so nothing arrives twice.
//
// It also keeps lonely rooms looking: while no network reaches anyone, rooms that
// can refresh() (re-announce) are refreshed now and then. Discovery that stalls,
// e.g. because a hidden tab's timers were slowed down, gets another chance. The wait
// doubles each time (a refresh also abandons handshakes still in flight, which under
// load can take a while) and resets as soon as someone is reached.
import { RoomBase } from './rooms.js';
import { every } from './ticker.js';

const DEFAULTS = {
  lonelyRefreshMs: 8000,     // a bad start shouldn't cost a minute alone...
  lonelyRefreshMaxMs: 30000, // ...and only lonely rooms re-announce, so relays barely notice
  lonelyCheckMs: 4000,
};

class MultiRoom extends RoomBase {
  constructor(rooms, options) {
    super(rooms[0].selfId);
    this.rooms = rooms;
    this.options = options;
    this.routes = new Map(); // peer id -> Set of rooms that reach it
    this.lonelySince = Date.now();
    this.refreshWaitMs = options.lonelyRefreshMs;
    for (const room of rooms) {
      room.onPeerJoin = id => this.reached(id, room);
      room.onPeerLeave = id => this.lost(id, room);
      room.onMessage = (bytes, from) => this.onMessage(bytes, from);
      room.peers().forEach(id => this.reached(id, room));
    }
    this.stopChecks = every(options.lonelyCheckMs, () => this.refreshIfLonely());
  }

  reached(id, room) {
    let routes = this.routes.get(id);
    const isNew = routes === undefined;
    if (isNew) { routes = new Set(); this.routes.set(id, routes); }
    routes.add(room);
    if (isNew) this.onPeerJoin(id);
  }

  lost(id, room) {
    const routes = this.routes.get(id);
    if (!routes) return;
    routes.delete(room);
    if (routes.size > 0) return;
    this.routes.delete(id);
    this.onPeerLeave(id);
  }

  refreshIfLonely() {
    if (this.routes.size > 0) {
      this.lonelySince = Date.now();
      this.refreshWaitMs = this.options.lonelyRefreshMs;
      return;
    }
    if (Date.now() - this.lonelySince < this.refreshWaitMs) return;
    this.lonelySince = Date.now();
    this.refreshWaitMs = Math.min(this.refreshWaitMs * 2, this.options.lonelyRefreshMaxMs);
    this.rooms.forEach(room => room.refresh?.());
  }

  route(id) { return this.routes.get(id)?.values().next().value; }

  peers() { return [...this.routes.keys()]; }

  send(bytes, to) {
    if (to !== undefined) { this.route(to)?.send(bytes, to); return; }
    for (const id of this.routes.keys()) this.route(id).send(bytes, id);
  }

  leave() {
    this.stopChecks();
    this.rooms.forEach(room => room.leave());
  }
}

export function multiNetwork(networks, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  return name => new MultiRoom(networks.map(joinRoom => joinRoom(name)), settings);
}
