// News for the page rather than the game, over the topology's META messages:
// world-wide (send) or to one roommate (sendTo). Each carries a type and a short
// text; one handler per type (census.js, castle_gate.js, roster.js, world_life.js, host_beacon.js).

export const META = { CENSUS: 1, CASTLE: 2, ROSTER: 3, LIFE: 5, HOST: 6 }; // 4 was announcements (gone)

const MAX_TEXT = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function frame(type, text) {
  const body = encoder.encode(text.slice(0, MAX_TEXT));
  const out = new Uint8Array(1 + body.length);
  out[0] = type;
  out.set(body, 1);
  return out;
}

export class MetaChannel {
  constructor(topology) {
    this.topology = topology;
    this.handlers = new Map(); // type -> (text, fromId) => {}
    topology.onMetaMessage = (payload, from) => this.receive(payload, from);
  }

  on(type, handler) { this.handlers.set(type, handler); }

  send(type, text) { this.topology.sendMeta(frame(type, text)); }

  sendTo(id, type, text) { this.topology.sendMetaTo(id, frame(type, text)); }

  receive(payload, from) {
    if (payload.length < 1 || payload.length > 1 + MAX_TEXT * 4) return;
    this.handlers.get(payload[0])?.(decoder.decode(payload.subarray(1)), from);
  }
}
