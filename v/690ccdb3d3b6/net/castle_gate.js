// The castle stays shut until the host opens it (host.js): the host's page signs
// the order, it travels the world, and every page that checks the signature opens
// its castle (the game asks Module.castleOpen, see src/pc/web/web_castle.c).
// Pages that know the order pass it on: delegates repeat it now and then and hand it
// to whoever joins their room, so latecomers learn it too. It's also remembered in
// the browser, per world, so a page reloaded later finds the castle open. The order
// ends after some hours (host.js): then the castle shuts again, for the next event.
import { META } from './meta_channel.js';
import { signOpenCastle, verifyOpenCastle } from './host.js';
import { every } from './ticker.js';

const DEFAULTS = { repeatMs: 60000 };
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
    this.signature = null; // the host's order, once known and checked
    this.until = 0;        // when it ends
    this.checking = new Set();
    this.onOpen = () => {};
    this.onClose = () => {};

    meta.on(META.CASTLE, text => this.heard(text));
    topology.addPeerJoinListener(id => this.tell(id));
    this.stopRepeats = every(this.options.repeatMs, () => this.repeat());
    this.heard(storage.get(storeKey(topology.world)) ?? '');
  }

  get isOpen() {
    if (this.signature !== null && Date.now() >= this.until) { this.signature = null; this.onClose(); }
    return this.signature !== null;
  }

  // The host's page: sign the order, open here, tell the world
  async openAsHost(hostKey) {
    const signature = await signOpenCastle(this.topology.world, hostKey);
    await this.heard(signature);
    if (this.isOpen) this.meta.send(META.CASTLE, signature);
    return this.isOpen;
  }

  async heard(signature) {
    if (this.isOpen || !signature || this.checking.has(signature)) return;
    this.checking.add(signature);
    const until = await verifyOpenCastle(this.topology.world, signature);
    this.checking.delete(signature);
    if (!until || this.isOpen) return;
    this.signature = signature;
    this.until = until;
    storage.set(storeKey(this.topology.world), signature);
    this.onOpen();
  }

  // also notices an opening that ended (isOpen)
  repeat() {
    if (this.isOpen && this.topology.isDelegate) this.meta.send(META.CASTLE, this.signature);
  }

  tell(id) {
    if (this.isOpen && this.topology.isDelegate) this.meta.sendTo(id, META.CASTLE, this.signature);
  }
}
