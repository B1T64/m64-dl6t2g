// How many players the whole world has, without a server: every room's delegate
// tells the world who's in its room now and then (short ids), and each page counts
// the different players in the reports it heard recently. Counting players rather
// than adding up rooms' head counts means someone who just moved to another level
// is counted once, though their old room's report is still around. A room whose
// delegate left stops counting once its report goes stale; my own room counts live.
// Delegates report every reportMs, and sooner when their room changed (someone came,
// left, or I moved), so a move shows up everywhere within seconds. A big room goes
// out in parts of PART_SIZE ids, each counted as its own entry.
import { META } from './meta_channel.js';
import { roster } from './seating.js';
import { every } from './ticker.js';

const DEFAULTS = {
  reportMs: 20000, // how often delegates report their room
  changeCheckMs: 3000, // how often they look for a change worth reporting at once
  freshMs: 50000,  // a report counts this long (a couple of missed ones)
  maxRooms: 4096,  // a cap, so a flood of made-up rooms can't grow it forever
};
const SHORT_ID = 8;    // enough to tell a few thousand players apart
const PART_SIZE = 50;  // ids per report message (a meta message carries 512 characters)
const MAX_MEMBERS = 64;
const FORMAT = 'v2';   // "v2|<room key>#<part>|<id>,<id>,..."; older reports (head counts) are ignored

const shortId = id => String(id).slice(0, SHORT_ID);

export class Census {
  constructor(topology, meta, options = {}) {
    this.topology = topology;
    this.meta = meta;
    this.options = { ...DEFAULTS, ...options };
    this.rooms = new Map(); // room key -> { members: [short ids], at }
    this.lastReport = '';
    meta.on(META.CENSUS, text => this.heard(text));
    const stopReports = every(this.options.reportMs, () => this.report());
    const stopChecks = every(this.options.changeCheckMs, () => this.reportIfChanged());
    this.stopReports = () => { stopReports(); stopChecks(); };
  }

  reportIfChanged() {
    const room = this.myRoom();
    if (room && this.topology.isDelegate && this.reportText(room) !== this.lastReport) this.report();
  }

  reportText(room) { return `${room.key}|${room.members.join(',')}`; }

  myRoom() {
    const { zone } = this.topology;
    return zone ? { key: `${zone.name}:${zone.shard}`, members: roster(zone.room).map(shortId) } : null;
  }

  report() {
    const room = this.myRoom();
    if (!room || !this.topology.isDelegate) return;
    this.lastReport = this.reportText(room);
    for (let at = 0, part = 0; at < room.members.length; at += PART_SIZE, part++) {
      const key = `${room.key}#${part}`;
      const members = room.members.slice(at, at + PART_SIZE);
      this.note(key, members);
      this.meta.send(META.CENSUS, `${FORMAT}|${key}|${members.join(',')}`);
    }
  }

  heard(text) {
    const [format, key, list] = text.split('|');
    if (format !== FORMAT || !key || !list) return;
    const members = list.split(',').filter(id => id.length > 0 && id.length <= SHORT_ID);
    if (members.length === 0 || members.length > MAX_MEMBERS) return;
    this.note(key, members);
  }

  note(key, members) {
    if (!this.rooms.has(key) && this.rooms.size >= this.options.maxRooms) return;
    this.rooms.set(key, { members, at: Date.now() });
  }

  // Players in the world as far as this page knows: at least my own room
  total() {
    const now = Date.now();
    const players = new Set(this.myRoom()?.members ?? []);
    for (const [key, { members, at }] of this.rooms) {
      if (now - at < this.options.freshMs) members.forEach(id => players.add(id));
      else this.rooms.delete(key);
    }
    return Math.max(players.size, 1);
  }
}
