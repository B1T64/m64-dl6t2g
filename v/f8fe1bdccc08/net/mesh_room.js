// Rooms where everyone reaches everyone, even across strict NATs.
// About one home connection in ten can't open a direct WebRTC link with some others.
// Members keep telling each other who they're connected to; a member heard of but
// still not connected after a grace period is reached through a roommate who is
// (one hop: the roommate hands the bytes over). No server involved.
//
// Frames on the underlying room, all shaped [type] [id count] [ids...] [payload]:
//   DATA     no ids              a normal message
//   ROSTER   the ids I reach     who I'm directly connected to
//   FORWARD  [target]            "please hand this payload to target"
//   RELAYED  [origin]            handed over on origin's behalf
// Ids are length-prefixed UTF-8.
import { RoomBase } from './rooms.js';
import { every } from './ticker.js';

const FRAME = { DATA: 0, ROSTER: 1, FORWARD: 2, RELAYED: 3 };

const DEFAULTS = {
  rosterMs: 2000,  // how often members share who they reach
  graceMs: 6000,   // time a direct connection gets to form before relaying
  staleMs: 7000,   // a roster older than this no longer vouches for anyone
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- framing ------------------------------------------------------------------------

const MAX_IDS = 255; // the count is one byte

function frame(type, ids, payload = new Uint8Array(0)) {
  const encoded = ids.slice(0, MAX_IDS).map(id => encoder.encode(id));
  const size = 2 + encoded.reduce((sum, id) => sum + 1 + id.length, 0) + payload.length;
  const out = new Uint8Array(size);
  out[0] = type;
  out[1] = encoded.length;
  let at = 2;
  for (const id of encoded) { out[at++] = id.length; out.set(id, at); at += id.length; }
  out.set(payload, at);
  return out;
}

// Returns { type, ids, payload }, or null when malformed
function unframe(bytes) {
  if (bytes.length < 2) return null;
  const ids = [];
  let at = 2;
  for (let i = 0; i < bytes[1]; i++) {
    if (at >= bytes.length) return null;
    const length = bytes[at++];
    if (at + length > bytes.length) return null;
    ids.push(decoder.decode(bytes.subarray(at, at + length)));
    at += length;
  }
  return { type: bytes[0], ids, payload: bytes.subarray(at) };
}

// --- room ---------------------------------------------------------------------------

class MeshRoom extends RoomBase {
  constructor(raw, options) {
    super(raw.selfId);
    this.raw = raw;
    this.options = options;
    this.vouchers = new Map();   // peer id -> Map(roommate id -> last roster time) for peers I don't reach
    this.firstHeard = new Map(); // peer id -> when a roster first mentioned it
    this.relayed = new Set();    // peers currently reached through a roommate

    raw.onPeerJoin = id => this.directJoined(id);
    raw.onPeerLeave = id => this.directLeft(id);
    raw.onMessage = (bytes, from) => this.receive(bytes, from);
    this.stopTicks = every(options.rosterMs, () => this.tick());
  }

  // ---- the room interface -----------------------------------------------------

  peers() { return [...this.raw.peers(), ...this.relayed]; }

  send(payload, to) {
    if (to === undefined) {
      this.raw.send(frame(FRAME.DATA, [], payload));
      this.relayed.forEach(id => this.forward(id, payload));
    } else if (this.relayed.has(to)) {
      this.forward(to, payload);
    } else {
      this.raw.send(frame(FRAME.DATA, [], payload), to);
    }
  }

  leave() {
    this.stopTicks();
    this.raw.leave();
  }

  // ---- direct links -----------------------------------------------------------

  isDirect(id) { return this.raw.peers().includes(id); }

  directJoined(id) {
    // someone we were already relaying to is now reachable directly: same peer, no event
    if (this.relayed.delete(id)) return;
    this.onPeerJoin(id);
  }

  directLeft(id) {
    if (this.voucherFor(id)) { this.relayed.add(id); return; } // still reachable through someone
    this.onPeerLeave(id);
  }

  // ---- relaying ---------------------------------------------------------------

  // A roommate that reaches `id` and has vouched for it recently
  voucherFor(id) {
    const now = Date.now();
    for (const [roommate, heard] of this.vouchers.get(id) ?? []) {
      if (now - heard <= this.options.staleMs && this.isDirect(roommate)) return roommate;
    }
    return null;
  }

  forward(id, payload) {
    const via = this.voucherFor(id);
    if (via) this.raw.send(frame(FRAME.FORWARD, [id], payload), via);
  }

  tick() {
    this.raw.send(frame(FRAME.ROSTER, this.raw.peers()));
    this.updateRelayed();
  }

  // Starts relaying to peers that never connected directly, stops for vanished ones
  updateRelayed() {
    const now = Date.now();
    for (const id of new Set([...this.vouchers.keys(), ...this.relayed])) {
      if (this.isDirect(id)) continue; // vouchers kept: they cover the link dropping later
      const reachable = this.voucherFor(id) !== null;
      if (!reachable) {
        this.forget(id);
        if (this.relayed.delete(id)) this.onPeerLeave(id);
        continue;
      }
      const waited = now - (this.firstHeard.get(id) ?? now);
      if (!this.relayed.has(id) && waited >= this.options.graceMs) {
        this.relayed.add(id);
        this.onPeerJoin(id);
      }
    }
  }

  forget(id) {
    this.vouchers.delete(id);
    this.firstHeard.delete(id);
  }

  // ---- receiving --------------------------------------------------------------

  receive(bytes, from) {
    const message = unframe(bytes);
    if (!message) return;
    const [id] = message.ids;
    switch (message.type) {
      case FRAME.DATA:
        this.onMessage(message.payload, from);
        break;
      case FRAME.ROSTER:
        this.heardRoster(message.ids, from);
        break;
      case FRAME.FORWARD:
        // hand over only to my own direct peers: relaying is never more than one hop
        if (id !== undefined && this.isDirect(id)) this.raw.send(frame(FRAME.RELAYED, [from], message.payload), id);
        break;
      case FRAME.RELAYED:
        if (id !== undefined) this.onMessage(message.payload, id);
        break;
    }
  }

  heardRoster(ids, from) {
    const now = Date.now();
    for (const id of ids) {
      if (id === this.selfId) continue;
      if (!this.vouchers.has(id)) { this.vouchers.set(id, new Map()); this.firstHeard.set(id, now); }
      this.vouchers.get(id).set(from, now);
    }
  }
}

export function meshNetwork(joinRoom, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  return name => new MeshRoom(joinRoom(name), settings);
}
