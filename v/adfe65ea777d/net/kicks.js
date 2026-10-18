// The host's bans (chat commands /Ban, /PermaBan, /Unban: ui/chat_commands.js). The
// host signs "out with this player until <time>" (host.js), naming them by name and,
// when they're in the host's room, by peer id and browser id too; every page then bans
// whoever matches (peer_hub.js: nothing they send reaches the game), also when they come
// back with a reload, until the ban runs out. /Unban is a newer order that ends it.
// A banned page that plays fair leaves the world and says so. Someone clearing their
// browser and renaming comes back as someone new: the host bans again.
// Bans are remembered per world and passed on: delegates repeat them, and every page
// tells a roommate who arrives.
import { META } from './meta_channel.js';
import { signKick, verifyKick } from './host.js';
import { every } from './ticker.js';

const REPEAT_MS = 60000;
const EXPIRY_CHECK_MS = 15000;
const MAX_KICKS = 200;
export const FOREVER = 0;
const storeKey = world => `sm64web.kicks.${world}`;
const kickedKey = world => `sm64web.kicked.${world}`;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};
const lower = text => String(text ?? '').toLowerCase();
const inForce = until => until === FOREVER || until > Date.now();

export class Kicks {
  constructor(topology, meta, hub, roster) {
    this.topology = topology;
    this.meta = meta;
    this.hub = hub;
    this.roster = roster;
    this.signed = new Map();    // signed text -> { peer, browser, name, until, at }
    this.bannedHere = new Set(); // peer ids this module banned (and may lift)
    this.onKicked = () => {};   // this page was banned

    meta.on(META.KICK, text => this.heard(text));
    roster.onChange(() => this.applyAll());
    topology.addPeerJoinListener(id => this.tell(id));
    const stopRepeats = every(REPEAT_MS, () => this.repeat());
    const stopChecks = every(EXPIRY_CHECK_MS, () => this.applyAll());
    this.stopRepeats = () => { stopRepeats(); stopChecks(); };
    for (const text of JSON.parse(storage.get(storeKey(topology.world)) || '[]')) this.heard(text);
  }

  // Whether this browser is banned from this world right now (it then stays out of it)
  static wasKicked(world) {
    const until = storage.get(kickedKey(world));
    return until !== null && inForce(Number(until));
  }

  // A roommate by name: exact (any case), else the only one it starts
  findRoommate(name) {
    const players = [...this.roster.players];
    return players.find(([, p]) => lower(p.name) === lower(name))
      ?? (players.filter(([, p]) => lower(p.name).startsWith(lower(name))).length === 1
        ? players.find(([, p]) => lower(p.name).startsWith(lower(name))) : null);
  }

  // until: ms since 1970, FOREVER, or a time past to lift a ban. Resolves with the name used.
  async orderAsHost(name, until, hostKey) {
    const roommate = this.findRoommate(name);
    const [peer, player] = roommate ?? ['', { name, browser: '' }];
    const text = await signKick(this.topology.world, { peer, browser: player.browser, name: player.name, until }, hostKey);
    await this.heard(text);
    this.meta.send(META.KICK, text);
    return player.name;
  }

  async heard(text) {
    if (this.signed.has(text) || this.signed.size >= MAX_KICKS) return;
    const order = await verifyKick(this.topology.world, text);
    if (!order) return;
    this.signed.set(text, order);
    storage.set(storeKey(this.topology.world), JSON.stringify([...this.signed.keys()]));
    this.applyAll();
  }

  // Each player's latest order wins (a newer /Unban ends an older /Ban); those in force
  activeOrders() {
    const latest = new Map(); // name -> order
    for (const order of this.signed.values()) {
      const key = lower(order.name) || order.peer;
      if (!latest.has(key) || latest.get(key).at < order.at) latest.set(key, order);
    }
    return [...latest.values()].filter(order => inForce(order.until));
  }

  matches(order, id, player) {
    return (order.peer && order.peer === id)
      || (order.browser && order.browser === player?.browser)
      || (order.name && lower(order.name) === lower(player?.name));
  }

  // Ban whoever an order in force names, lift bans that ran out; leave if one names me
  applyAll() {
    const orders = this.activeOrders();
    const mine = orders.find(o => this.matches(o, this.topology.zone?.room.selfId, this.roster.mine));
    if (mine) {
      storage.set(kickedKey(this.topology.world), String(mine.until));
      this.onKicked(mine.until);
      return;
    }
    const shouldBan = new Set(orders.map(o => o.peer).filter(Boolean));
    for (const [id, player] of this.roster.players) {
      if (orders.some(o => this.matches(o, id, player))) shouldBan.add(id);
    }
    for (const id of shouldBan) {
      if (!this.hub.isBanned(id)) { this.hub.ban(id); this.bannedHere.add(id); }
    }
    for (const id of [...this.bannedHere]) {
      if (!shouldBan.has(id)) { this.hub.unban(id); this.bannedHere.delete(id); }
    }
  }

  tell(id) { this.signed.forEach((_, text) => this.meta.sendTo(id, META.KICK, text)); }

  repeat() {
    if (this.topology.isDelegate) this.signed.forEach((_, text) => this.meta.send(META.KICK, text));
  }
}
