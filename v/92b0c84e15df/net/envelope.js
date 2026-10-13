// What travels between rooms of the topology.
//   ZONE       [kind] payload                                    stays in one room
//   WORLD      [kind] [id x8] [origin length] [origin] payload   relayed everywhere
//   LEVEL      same as WORLD                                     relayed within a level
//   DIRECTORY  same as WORLD, payload [shard] [members]          a room's occupancy,
//                                                                relayed among the level's leaders
// Relayed messages carry a random id, so every relay delivers and forwards each
// exactly once, and their origin, so receivers know who first sent them.

export const KIND = { ZONE: 1, WORLD: 2, LEVEL: 3, DIRECTORY: 4 };

const ID_BYTES = 8;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export const isRelayed = kind => kind === KIND.WORLD || kind === KIND.LEVEL || kind === KIND.DIRECTORY;

export function sealZone(payload) {
  const out = new Uint8Array(1 + payload.length);
  out[0] = KIND.ZONE;
  out.set(payload, 1);
  return out;
}

// Returns the sealed bytes and the id they carry
export function sealRelayed(kind, payload, origin) {
  const id = crypto.getRandomValues(new Uint8Array(ID_BYTES));
  const originBytes = encoder.encode(origin);
  const head = 2 + ID_BYTES + originBytes.length;
  const out = new Uint8Array(head + payload.length);
  out[0] = kind;
  out.set(id, 1);
  out[1 + ID_BYTES] = originBytes.length;
  out.set(originBytes, 2 + ID_BYTES);
  out.set(payload, head);
  return { bytes: out, id: hex(id) };
}

export const directoryPayload = (shard, members) => Uint8Array.of(shard, Math.min(members, 255));
export const readDirectory = payload => (payload.length === 2 ? { shard: payload[0], members: payload[1] } : null);

// Returns { kind, payload } or { kind, id, origin, payload }, or null when malformed
export function open(bytes) {
  const kind = bytes[0];
  if (kind === KIND.ZONE) return { kind, payload: bytes.subarray(1) };
  if (!isRelayed(kind) || bytes.length < 2 + ID_BYTES) return null;
  const originLength = bytes[1 + ID_BYTES];
  const head = 2 + ID_BYTES + originLength;
  if (bytes.length < head) return null;
  return {
    kind,
    id: hex(bytes.subarray(1, 1 + ID_BYTES)),
    origin: decoder.decode(bytes.subarray(2 + ID_BYTES, head)),
    payload: bytes.subarray(head),
  };
}

// Bounded memory of relayed message ids already handled
export class RecentIds {
  constructor(limit = 4096) { this.limit = limit; this.set = new Set(); this.order = []; }
  has(id) { return this.set.has(id); }
  add(id) {
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.limit) this.set.delete(this.order.shift());
  }
}
