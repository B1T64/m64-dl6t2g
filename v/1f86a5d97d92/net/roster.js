// Who's in my room: each page tells its roommates its name and how its voice chat is
// set (talking: sends its microphone; listening: wants to hear others), when they
// arrive and whenever that changes. The players list and voice.js read it.
import { META } from './meta_channel.js';

const MAX_NAME = 32;

export class RoomRoster {
  constructor(topology, meta) {
    this.topology = topology;
    this.meta = meta;
    this.mine = { name: '', talking: false, listening: false };
    this.players = new Map(); // id -> { name, talking, listening }
    this.listeners = new Set();

    meta.on(META.ROSTER, (text, from) => this.heard(text, from));
    topology.addPeerJoinListener(id => this.tell(id));
    topology.addPeerLeaveListener(id => { if (this.players.delete(id)) this.changed(); });
  }

  onChange(listener) { this.listeners.add(listener); }

  changed() { this.listeners.forEach(listener => listener()); }

  setMine(fields) {
    Object.assign(this.mine, fields);
    this.topology.exposed.forEach(id => this.tell(id));
    this.changed();
  }

  tell(id) { this.meta.sendTo(id, META.ROSTER, JSON.stringify(this.mine)); }

  heard(text, from) {
    if (!this.topology.isZonePeer(from)) return; // roommates only
    let entry;
    try { entry = JSON.parse(text); } catch { return; }
    this.players.set(from, {
      name: String(entry?.name ?? '').slice(0, MAX_NAME),
      talking: entry?.talking === true,
      listening: entry?.listening === true,
    });
    this.changed();
  }
}
