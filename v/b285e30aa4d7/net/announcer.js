// The host's announcements: a line of text every page shows at once. The host's page
// signs it (host.js) and sends it world-wide; pages show only signed, recent ones,
// each once. Nobody repeats them: someone arriving later didn't need it.
import { META } from './meta_channel.js';
import { signAnnouncement, verifyAnnouncement } from './host.js';

const FRESH_MS = 2 * 60 * 1000; // older ones (a slow relay, a replay) aren't news anymore

export class Announcer {
  constructor(topology, meta) {
    this.topology = topology;
    this.meta = meta;
    this.lastAt = 0;
    this.onAnnouncement = () => {}; // (text)
    meta.on(META.ANNOUNCE, text => this.heard(text));
  }

  async announceAsHost(text, hostKey) {
    const signed = await signAnnouncement(this.topology.world, text, hostKey);
    await this.heard(signed);
    this.meta.send(META.ANNOUNCE, signed);
  }

  async heard(signed) {
    const announcement = await verifyAnnouncement(this.topology.world, signed);
    if (!announcement || announcement.at <= this.lastAt || Date.now() - announcement.at > FRESH_MS) return;
    this.lastAt = announcement.at;
    this.onAnnouncement(announcement.text);
  }
}
