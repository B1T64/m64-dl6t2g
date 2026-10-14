// How many players the whole world has, without a server: every room's delegate
// tells the world its head count now and then, and each page adds up the counts it
// heard recently. A room whose delegate left stops counting once its count goes stale.
import { META } from './meta_channel.js';
import { roster } from './seating.js';
import { every } from './ticker.js';

const DEFAULTS = {
  reportMs: 20000, // how often delegates report their room
  freshMs: 50000,  // a report counts this long (a couple of missed ones)
  maxRooms: 4096,  // a cap, so a flood of made-up rooms can't grow it forever
};

export class Census {
  constructor(topology, meta, options = {}) {
    this.topology = topology;
    this.meta = meta;
    this.options = { ...DEFAULTS, ...options };
    this.rooms = new Map(); // room key -> { count, at }
    meta.on(META.CENSUS, text => this.heard(text));
    this.stopReports = every(this.options.reportMs, () => this.report());
  }

  myRoom() {
    const { zone } = this.topology;
    return zone ? { key: `${zone.name}:${zone.shard}`, count: roster(zone.room).length } : null;
  }

  report() {
    const room = this.myRoom();
    if (!room || !this.topology.isDelegate) return;
    this.note(room.key, room.count);
    this.meta.send(META.CENSUS, `${room.count}|${room.key}`);
  }

  heard(text) {
    const split = text.indexOf('|');
    const count = Number(text.slice(0, split));
    const key = text.slice(split + 1);
    if (split < 1 || !key || !Number.isInteger(count) || count < 1 || count > 64) return;
    this.note(key, count);
  }

  note(key, count) {
    if (!this.rooms.has(key) && this.rooms.size >= this.options.maxRooms) return;
    this.rooms.set(key, { count, at: Date.now() });
  }

  // Players in the world as far as this page knows: at least my own room
  total() {
    const now = Date.now();
    let sum = 0;
    for (const [key, { count, at }] of this.rooms) {
      if (now - at < this.options.freshMs) sum += count; else this.rooms.delete(key);
    }
    return Math.max(sum, this.myRoom()?.count ?? 1);
  }
}
