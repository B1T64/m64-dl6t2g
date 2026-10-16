// The event's host tells the world it's here, signed with the host key (host.js), so
// the pages in its area send it their full-rate presence wherever they stand
// (src/pc/web/web_world.c): the host draws everyone in its level, not just the nearest.
// The signature names the host's own peer id, so nobody can claim to be the host.
import { META } from './meta_channel.js';
import { signHostPresence, verifyHostPresence } from './host.js';
import { every } from './ticker.js';

const REPEAT_MS = 10000;

export class HostBeacon {
  constructor(topology, meta) {
    this.topology = topology;
    this.meta = meta;
    this.hostKey = null;  // set on the host's own page
    this.hostId = null;   // the host's peer id, once a signed beacon arrived
    this.onHost = () => {}; // (id)

    meta.on(META.HOST, (text, from) => this.heard(text, from));
    topology.addPeerJoinListener(id => this.tell(id)); // a roommate arriving hears it at once
    this.stopRepeats = every(REPEAT_MS, () => this.announce());
  }

  get selfId() { return this.topology.zone?.room.selfId ?? null; }

  actAsHost(hostKey) {
    this.hostKey = hostKey;
    this.announce();
  }

  async signed() {
    return this.hostKey && this.selfId ? signHostPresence(this.topology.world, this.selfId, this.hostKey) : null;
  }

  async announce() {
    const text = await this.signed();
    if (text) this.meta.send(META.HOST, text);
  }

  async tell(id) {
    const text = await this.signed();
    if (text) this.meta.sendTo(id, META.HOST, text);
  }

  async heard(text, from) {
    if (!from || from === this.hostId) return;
    if (await verifyHostPresence(this.topology.world, from, text)) {
      this.hostId = from;
      this.onHost(from);
    }
  }
}
