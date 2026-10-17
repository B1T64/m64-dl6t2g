// The host's kicks: the host signs "out with this player" (host.js) naming their peer
// id, their browser id and their name; every page then bans whoever matches any of
// them (peer_hub.js: nothing they send reaches the game), now and when they come back
// with a reload. A kicked page that plays fair leaves the world and says so. Someone
// clearing their browser comes back as someone new: the host kicks again.
// Kicks are remembered per world and passed on: delegates repeat them, and every page
// tells a roommate who arrives.
import { META } from './meta_channel.js';
import { signKick, verifyKick } from './host.js';
import { every } from './ticker.js';

const REPEAT_MS = 60000;
const MAX_KICKS = 200;
const storeKey = world => `sm64web.kicks.${world}`;
const KICKED_KEY = world => `sm64web.kicked.${world}`;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

export class Kicks {
  constructor(topology, meta, hub, roster) {
    this.topology = topology;
    this.meta = meta;
    this.hub = hub;
    this.roster = roster;
    this.signed = new Map();   // signed text -> { peer, browser, name }
    this.onKicked = () => {};  // this page was kicked

    meta.on(META.KICK, text => this.heard(text));
    roster.onChange(() => this.applyAll());
    topology.addPeerJoinListener(id => this.tell(id));
    this.stopRepeats = every(REPEAT_MS, () => this.repeat());
    for (const text of JSON.parse(storage.get(storeKey(topology.world)) || '[]')) this.heard(text);
  }

  // Whether this browser was kicked from this world (it then stays out of it)
  static wasKicked(world) { return storage.get(KICKED_KEY(world)) === '1'; }

  async kickAsHost(id, hostKey) {
    const player = this.roster.players.get(id);
    if (!player) return false;
    const text = await signKick(this.topology.world, { peer: id, browser: player.browser, name: player.name }, hostKey);
    await this.heard(text);
    this.meta.send(META.KICK, text);
    return true;
  }

  async heard(text) {
    if (this.signed.has(text) || this.signed.size >= MAX_KICKS) return;
    const target = await verifyKick(this.topology.world, text);
    if (!target) return;
    this.signed.set(text, target);
    storage.set(storeKey(this.topology.world), JSON.stringify([...this.signed.keys()]));
    this.applyAll();
  }

  matches(target, id, player) {
    return target.peer === id
      || (target.browser && target.browser === player?.browser)
      || (target.name && target.name.toLowerCase() === player?.name?.toLowerCase());
  }

  // Ban every roommate a kick names; leave if one names me
  applyAll() {
    const targets = [...this.signed.values()];
    if (targets.some(t => this.matches(t, this.topology.zone?.room.selfId, this.roster.mine))) {
      storage.set(KICKED_KEY(this.topology.world), '1');
      this.onKicked();
      return;
    }
    for (const { peer } of targets) { if (peer && !this.hub.isBanned(peer)) this.hub.ban(peer); } // wherever they are
    for (const [id, player] of this.roster.players) {
      if (!this.hub.isBanned(id) && targets.some(t => this.matches(t, id, player))) this.hub.ban(id);
    }
  }

  tell(id) { this.signed.forEach((_, text) => this.meta.sendTo(id, META.KICK, text)); }

  repeat() {
    if (this.topology.isDelegate) this.signed.forEach((_, text) => this.meta.send(META.KICK, text));
  }
}
