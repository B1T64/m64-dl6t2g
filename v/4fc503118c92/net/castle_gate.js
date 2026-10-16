// The castle stays shut until the host opens it, and the host can shut it again
// (host.js): the host's page signs each order, it travels the world, and every page
// that checks the signature follows the newest one (the game asks Module.castleOpen,
// see src/pc/web/web_castle.c). A fresh "close" also sends everyone back out to the
// castle grounds (Module.castleKicks, counted here).
// Pages that know the newest order pass it on: delegates repeat it now and then and
// hand it to whoever joins their room, so latecomers learn it too. It's also
// remembered in the browser, per world. An opening runs out after some hours.
import { META } from './meta_channel.js';
import { CASTLE, signCastleOrder, verifyCastleOrder, castleOpenBy } from './host.js';
import { every } from './ticker.js';

const DEFAULTS = {
  repeatMs: 60000,
  kickFreshMs: 60000, // a close this recent sends players out; an older one (stored, or
                      // heard on arrival) only keeps the door shut
};
const storeKey = world => `sm64web.castle.${world}`;

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

export class CastleGate {
  constructor(topology, meta, options = {}) {
    this.topology = topology;
    this.meta = meta;
    this.options = { ...DEFAULTS, ...options };
    this.order = null;  // the newest checked order: { action, at, text }
    this.wasOpen = false;
    this.kicks = 0;     // fresh closes so far
    this.checking = new Set();
    this.onChange = () => {}; // (isOpen, kicks)

    meta.on(META.CASTLE, text => this.heard(text));
    topology.addPeerJoinListener(id => this.tell(id));
    this.stopRepeats = every(this.options.repeatMs, () => this.repeat());
    this.heard(storage.get(storeKey(topology.world)) ?? '');
  }

  get isOpen() { return castleOpenBy(this.order); }

  // The host's page: sign the order, follow it here, tell the world
  async orderAsHost(action, hostKey) {
    const text = await signCastleOrder(this.topology.world, action, hostKey);
    await this.heard(text);
    if (this.order?.text !== text) return false;
    this.meta.send(META.CASTLE, text);
    return true;
  }

  openAsHost(hostKey) { return this.orderAsHost(CASTLE.OPEN, hostKey); }
  closeAsHost(hostKey) { return this.orderAsHost(CASTLE.CLOSE, hostKey); }

  async heard(text) {
    if (!text || text === this.order?.text || this.checking.has(text)) return;
    this.checking.add(text);
    const order = await verifyCastleOrder(this.topology.world, text);
    this.checking.delete(text);
    if (!order || (this.order && order.at <= this.order.at)) return; // older news
    this.order = { ...order, text };
    storage.set(storeKey(this.topology.world), text);
    if (order.action === CASTLE.CLOSE && Date.now() - order.at < this.options.kickFreshMs) this.kicks++;
    this.changed();
  }

  // Tells the owner when the castle opens, shuts, or someone is sent out
  changed() {
    this.wasOpen = this.isOpen;
    this.onChange(this.wasOpen, this.kicks);
  }

  // also notices an opening that ran out
  repeat() {
    if (this.isOpen !== this.wasOpen) this.changed();
    if (this.order && this.topology.isDelegate) this.meta.send(META.CASTLE, this.order.text);
  }

  tell(id) {
    if (this.order && this.topology.isDelegate) this.meta.sendTo(id, META.CASTLE, this.order.text);
  }
}
