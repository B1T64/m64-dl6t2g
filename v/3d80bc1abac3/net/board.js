// Seat boards: how full each shard of a room family is, readable without joining
// any room. Without one, every newcomer to a level first sits in its shard 0 and
// asks around there; when a crowd arrives at once (an event link going out), that
// one room briefly holds hundreds of WebRTC handshakes. With a board, a newcomer
// reads the shards' head counts and how many others are arriving right now, and
// goes straight to a seat (see chooseShard in seating.js).
//
//   board.ready                      whether it can be read at all
//   board.read(base)    -> Promise<{ occupancy: Map<shard, members>, arriving }>
//   board.post(base, shard, members) a room leader's head count
//   board.arrive(base)               "I'm about to pick a shard of base"
//
// mqttBoard keeps it as retained messages on public MQTT brokers (the kind Trystero
// already signals through; no server of ours). Entries expire on the broker (MQTT 5)
// and carry their time, so rooms that emptied and arrivals that sat down stop counting.

import { loadVendor } from './vendor/vendor.js';

const BROKERS = ['broker.emqx.io:8084/mqtt', 'broker.hivemq.com:8884/mqtt', 'test.mosquitto.org:8081/mqtt']
  .map(url => `wss://${url}`);

const DEFAULTS = {
  readMs: 1200,       // how long a read listens for retained entries
  connectMs: 4000,    // brokers not connected by then are left out of the start
  postTtlS: 30,       // a head count outlives its last post by this much
  arrivalTtlS: 8,     // an arrival counts this long (time to sit down and be counted)
};

export const NO_BOARD = Object.freeze({
  ready: false,
  read: async () => ({ occupancy: new Map(), arriving: 0 }),
  post() {},
  arrive() {},
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeTopic = text => text.replace(/[^\w:.-]/g, '_');

// Entries: <namespace>/<base>/s/<shard> = { n, t }, <namespace>/<base>/a/<token> = { t }
export class MqttBoard {
  constructor(clients, namespace, options = {}) {
    this.clients = clients;
    this.namespace = safeTopic(namespace);
    this.options = { ...DEFAULTS, ...options };
    this.readers = new Set(); // { prefix, take(topic, entry) }
    for (const client of clients) {
      client.on('message', (topic, payload) => this.heard(topic, payload));
      client.on('error', () => {}); // a broker going away is not the game's problem
    }
  }

  get ready() { return this.clients.some(client => client.connected); }

  topic(base, ...rest) { return [this.namespace, safeTopic(base), ...rest].join('/'); }

  publish(topic, entry, ttlS) {
    const payload = JSON.stringify({ ...entry, t: Date.now() });
    const options = { retain: true, qos: 0, properties: { messageExpiryInterval: ttlS } };
    this.clients.forEach(client => { if (client.connected) client.publish(topic, payload, options); });
  }

  post(base, shard, members) {
    this.publish(this.topic(base, 's', shard), { n: members }, this.options.postTtlS);
  }

  arrive(base) {
    const token = Math.random().toString(36).slice(2, 10);
    this.publish(this.topic(base, 'a', token), {}, this.options.arrivalTtlS);
  }

  heard(topic, payload) {
    let entry;
    try { entry = JSON.parse(payload.toString()); } catch { return; }
    if (typeof entry?.t !== 'number') return;
    for (const reader of this.readers) if (topic.startsWith(reader.prefix)) reader.take(topic.slice(reader.prefix.length), entry);
  }

  // Every broker's retained entries, the freshest one winning per topic
  async read(base) {
    const prefix = this.topic(base, '');
    const latest = new Map(); // relative topic -> entry
    const reader = { prefix, take: (rest, entry) => { if (!(latest.get(rest)?.t >= entry.t)) latest.set(rest, entry); } };
    const live = this.clients.filter(client => client.connected);
    this.readers.add(reader);
    live.forEach(client => client.subscribe(`${prefix}#`, { qos: 0 }));
    await sleep(this.options.readMs);
    live.forEach(client => client.unsubscribe(`${prefix}#`));
    this.readers.delete(reader);
    return this.snapshot(latest);
  }

  // Clocks differ between players, so ages are judged generously; the broker's own expiry does the rest
  snapshot(latest) {
    const now = Date.now();
    const occupancy = new Map();
    let arriving = 0;
    for (const [rest, entry] of latest) {
      const [kind, key] = rest.split('/');
      const age = (now - entry.t) / 1000;
      if (kind === 's' && age < 2 * this.options.postTtlS && Number.isInteger(entry.n)) occupancy.set(Number(key), entry.n);
      if (kind === 'a' && age < 2 * this.options.arrivalTtlS) arriving++;
    }
    return { occupancy, arriving };
  }
}

// A post of a room's head count: when it changes, and again before it expires
export class HeadCount {
  constructor(board, refreshMs = 10000) {
    this.board = board;
    this.refreshMs = refreshMs;
    this.last = { key: null, members: -1, at: 0 };
  }

  update(base, shard, members) {
    const key = `${base}:${shard}`;
    const now = Date.now();
    const { last } = this;
    if (key === last.key && members === last.members && now - last.at < this.refreshMs) return;
    this.last = { key, members, at: now };
    this.board.post(base, shard, members);
  }
}

// Connects to the brokers, waiting a moment for the first one (the rest, and any that
// drop, join in as they connect; until one does, the board isn't ready and the
// topology does without). NO_BOARD if mqtt won't load. Node passes how to load it.
export async function mqttBoard(namespace, { load = async () => ({ default: (await loadVendor()).mqtt }), brokers = BROKERS, options } = {}) {
  let mqtt;
  try { mqtt = (await load()).default; } catch { return NO_BOARD; }
  const clients = brokers.map(url => mqtt.connect(url, { protocolVersion: 5, reconnectPeriod: 5000, connectTimeout: 8000 }));
  const settings = { ...DEFAULTS, ...options };
  const connected = clients.map(client => new Promise(resolve => client.once('connect', resolve)));
  await Promise.race([Promise.any(connected), sleep(settings.connectMs)]).catch(() => {});
  return new MqttBoard(clients, namespace, settings);
}
