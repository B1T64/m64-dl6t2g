// Who connects to whom, so the world grows to hundreds without a full mesh.
//
//   zone rooms   <world>:zone:<zone>:<shard>
//       The players of one zone (a level), all connected to each other; at most
//       `capacity` per room, crowded zones spill into more shards. Gameplay stays here.
//   level tree   <world>:level:<zone>:<shard> + :spine          (tree_bridge.js)
//       The leaders of every room of one zone: relays LEVEL messages between them,
//       and each room's occupancy (DIRECTORY) so newcomers pick a room with a free
//       seat at once instead of trying them one by one.
//   backbone     <world>:backbone:<shard> + :spine              (tree_bridge.js)
//       The leaders of every zone room: relays WORLD messages.
// Both trees seat `bridgeCapacity` leaders per shard, so no leader ever holds more
// than a few dozen links, whether the level or the world has 50 players or 500.
//
// Newcomers find a seat through the seat board (board.js) when there is one: they
// read every shard's head count and go straight to a free seat, so a crowd arriving
// at once spreads over rooms instead of all passing through shard 0. Without a board
// they sit in shard 0 at once and read the occupancy from the level tree instead.
//
// Leaders of a room are its delegate and deputy (lowest ids, see seating.js). Both
// sit on the trees, so when the delegate leaves, the deputy is already there and
// nothing is lost; only the delegate relays between its room and the trees.
// Relaying is one rule: whatever arrives through one link goes out through every
// other link I relay on, once (envelope.js ids make repeats harmless). Delivering and
// passing on are tracked apart: a deputy hears its room's news from the room first
// and leaves it to the delegate, but when the same news reaches it through a tree
// shard where it leads, it still has to pass it on there.

import { KIND, isRelayed, sealZone, sealRelayed, directoryPayload, readDirectory, open, RecentIds } from './envelope.js';
import { ROLE, roster, hasSeat, roleIn, joinSeated, chooseShard } from './seating.js';
import { TreeBridge } from './tree_bridge.js';
import { HeadCount, NO_BOARD } from './board.js';
import { every } from './ticker.js';

const DEFAULTS = {
  capacity: 16,        // matches the 15 remote players a game can draw, plus yourself
  bridgeCapacity: 16,  // leaders per shard of the level tree and the backbone
  maxShards: 255,      // rooms per level (a shard number travels as one byte)
  bridgeMaxShards: 64, // shards per tree: 64 x 16 leaders, some 8000 players
  board: NO_BOARD,
  settleMs: 3000,      // time for a freshly joined room to show who's in it
  directoryMs: 3000,   // how often delegates publish their room's occupancy
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class WorldTopology {
  constructor(joinRoom, world, options = {}) {
    this.joinRoom = joinRoom;
    this.world = world;
    this.options = { ...DEFAULTS, ...options };
    this.delivered = new RecentIds(); // relayed messages handed to the game (or the directory)
    this.relayed = new RecentIds();   // ...and those I passed on
    this.exposed = new Set();

    this.zone = null;           // { name, shard, room }
    this.directory = new Map(); // shard -> members, as last published in my level tree
    this.directoryRead = Promise.resolve();
    this.trustDirectory = false;
    this.role = ROLE.MEMBER;    // in my zone room
    this.levelTree = null;
    this.backbone = null;
    this.zoneVersion = 0;       // bumps on every zone change, so stale work gives up
    this.headCount = new HeadCount(this.options.board);

    // outputs, assigned by the owner
    this.onPeerJoined = () => {};
    this.onPeerLeft = () => {};
    this.onZoneMessage = () => {};   // (payload, fromId)
    this.onLevelMessage = () => {};  // (payload, originId)
    this.onWorldMessage = () => {};  // (payload, originId)
    this.onMetaMessage = () => {};   // (payload, originId): world-wide news for the page (meta_channel.js)

    this.stopDirectory = every(this.options.directoryMs, () => this.publishOccupancy());
  }

  // ---- inputs -----------------------------------------------------------------

  // Most levels aren't full: sit in the first room right away while reading the
  // directory; if that room has no seat for me, rebalanceSoon uses the directory
  // to go straight to one that does.
  setZone(name) {
    if (this.zone?.name === name) return;
    const version = ++this.zoneVersion;
    this.leaveZone();
    if (this.board.ready) { this.enterFromBoard(name, version); return; }
    this.directoryRead = this.readDirectory(name, version);
    this.trustDirectory = true; // once: a moving crowd makes it stale (see rebalanceSoon)
    this.adopt(name, 0, this.joinRoom(this.zoneRoomName(name, 0)), version);
  }

  get board() { return this.options.board; }

  // With a seat board: read it, then sit where it shows a seat. The room is adopted
  // at once, like the unguided first try, and rebalanceSoon still checks the seat.
  async enterFromBoard(name, version, full = []) {
    this.directoryRead = Promise.resolve();
    this.board.arrive(this.zoneBase(name));
    const snapshot = await this.board.read(this.zoneBase(name));
    if (version !== this.zoneVersion) return;
    const shard = chooseShard(snapshot, this.options, new Set(full));
    this.adopt(name, shard, this.joinRoom(this.zoneRoomName(name, shard)), version);
  }

  sendTo(id, payload) {
    if (this.zone && this.exposed.has(id)) this.zone.room.send(sealZone(payload), id);
  }

  sendZone(payload) { this.zone?.room.send(sealZone(payload)); }
  sendLevel(payload) { this.sendRelayed(KIND.LEVEL, payload); }
  sendWorld(payload) { this.sendRelayed(KIND.WORLD, payload); }
  sendMeta(payload) { this.sendRelayed(KIND.META, payload); }

  // ---- introspection ------------------------------------------------------------

  get isDelegate() { return this.role === ROLE.DELEGATE; }
  get isDeputy() { return this.role === ROLE.DEPUTY; }
  // One room per level answers questions sent to the whole level, so a crowded level
  // replies once instead of once per room
  get isLevelSpokesman() { return this.isDelegate && this.zone?.shard === 0; }
  isZonePeer(id) { return this.exposed.has(id); }
  get connectionCount() {
    return (this.zone ? this.zone.room.peers().length : 0)
      + (this.levelTree?.connectionCount ?? 0) + (this.backbone?.connectionCount ?? 0);
  }

  zoneRoomName(name, shard) { return `${this.zoneBase(name)}:${shard}`; }
  zoneBase(name) { return `${this.world}:zone:${name}`; }
  levelTreeBase(name) { return `${this.world}:level:${name}`; }

  // ---- choosing a room ------------------------------------------------------------

  // The rooms' occupancy as published in the zone's level tree. Leaders are in it
  // already; anyone else listens in on its first shard for a moment. An empty map
  // means nobody is there yet.
  async readDirectory(name, version) {
    this.directory = new Map();
    const observer = this.levelTree ? null : this.joinRoom(`${this.levelTreeBase(name)}:0`);
    if (observer) observer.onMessage = bytes => this.receive(observer, bytes);
    await sleep(this.options.settleMs);
    observer?.leave();
    return version === this.zoneVersion ? this.directory : new Map();
  }

  // The lowest shard with a free seat, else a fresh one past the known ones
  pickShard(occupancy) {
    const shards = [...occupancy.keys()].sort((a, b) => a - b);
    const free = shards.find(shard => occupancy.get(shard) < this.options.capacity);
    if (free !== undefined) return free;
    return shards.length ? Math.min(shards[shards.length - 1] + 1, this.options.maxShards - 1) : 0;
  }

  // ---- my zone room ----------------------------------------------------------------

  adopt(name, shard, room, version) {
    this.zone = { name, shard, room };
    room.onPeerJoin = id => { this.expose(id); this.zoneMembershipChanged(version); };
    room.onPeerLeave = id => { this.hide(id); this.zoneMembershipChanged(version); };
    room.onMessage = (bytes, from) => this.receive(room, bytes, from);
    room.peers().forEach(id => this.expose(id));
    this.zoneMembershipChanged(version);
  }

  leaveZone() {
    if (!this.zone) return;
    [...this.exposed].forEach(id => this.hide(id));
    this.zone.room.leave();
    this.zone = null;
    this.role = ROLE.MEMBER;
    this.leaveTrees();
  }

  expose(id) {
    if (this.exposed.has(id)) return;
    this.exposed.add(id);
    this.onPeerJoined(id);
  }

  hide(id) {
    if (this.exposed.delete(id)) this.onPeerLeft(id);
  }

  zoneMembershipChanged(version) {
    this.updateRole();
    this.publishOccupancy();
    this.rebalanceSoon(version);
  }

  // A full room, or simultaneous arrivals overfilling one: the ones past capacity
  // move on. Arriving at a full room, the directory points straight to a free one;
  // after that, moves go shard by shard, which converges even while a whole crowd
  // is moving and every directory entry is out of date.
  async rebalanceSoon(version) {
    await sleep(this.options.settleMs);
    await this.directoryRead;
    if (version !== this.zoneVersion || !this.zone || hasSeat(this.zone.room, this.options.capacity)) return;

    const { name, shard } = this.zone;
    const next = ++this.zoneVersion;
    this.leaveZone();
    if (this.board.ready) { this.enterFromBoard(name, next, [shard]); return; }
    const useDirectory = this.trustDirectory && this.directory.size > 0;
    this.trustDirectory = false;
    if (useDirectory) {
      const target = this.pickShard(this.directory);
      this.adopt(name, target, this.joinRoom(this.zoneRoomName(name, target)), next);
      return;
    }
    const seated = await joinSeated(this.joinRoom, this.zoneBase(name), {
      ...this.options, firstShard: shard + 1, isStale: () => next !== this.zoneVersion,
    });
    if (seated) this.adopt(name, seated.shard, seated.room, next);
  }

  // Delegates tell the seat board and the level tree how full their room is (never
  // their own room); tree delegates keep their tree shards' counts posted too
  publishOccupancy() {
    this.levelTree?.postHeadCount();
    this.backbone?.postHeadCount();
    if (!this.isDelegate) return;
    this.headCount.update(this.zoneBase(this.zone.name), this.zone.shard, roster(this.zone.room).length);
    if (!this.levelTree) return;
    const payload = directoryPayload(this.zone.shard, roster(this.zone.room).length);
    const { bytes, id } = sealRelayed(KIND.DIRECTORY, payload, this.zone.room.selfId);
    this.markOwn(id);
    this.directory.set(this.zone.shard, roster(this.zone.room).length);
    this.levelTree.links.forEach(link => link.send(bytes));
  }

  // ---- trees -----------------------------------------------------------------------

  updateRole() {
    this.role = this.zone ? roleIn(this.zone.room) : ROLE.MEMBER;
    if (this.role === ROLE.MEMBER) { this.leaveTrees(); return; }

    const treeOptions = { ...this.options, capacity: this.options.bridgeCapacity, maxShards: this.options.bridgeMaxShards };
    const hear = { onMessage: (link, bytes) => this.receive(link, bytes) };
    if (!this.levelTree) {
      // someone joining my shard may be a newcomer reading the directory
      this.levelTree = new TreeBridge(this.joinRoom, this.levelTreeBase(this.zone.name), treeOptions,
        { ...hear, onShardJoin: () => this.publishOccupancy() });
      this.levelTree.join();
    }
    if (!this.backbone) {
      this.backbone = new TreeBridge(this.joinRoom, `${this.world}:backbone`, treeOptions, hear);
      this.backbone.join();
    }
  }

  leaveTrees() {
    this.levelTree?.leave();
    this.backbone?.leave();
    this.levelTree = this.backbone = null;
  }

  // ---- relaying -------------------------------------------------------------------

  // Links I relay `kind` on. My zone room only counts while I'm its delegate, and
  // never for room occupancy, which only the level's leaders need.
  relayLinks(kind) {
    const links = [];
    if (this.isDelegate && this.zone && kind !== KIND.DIRECTORY) links.push(this.zone.room);
    if ((kind === KIND.LEVEL || kind === KIND.DIRECTORY) && this.levelTree) links.push(...this.levelTree.links);
    if ((kind === KIND.WORLD || kind === KIND.META) && this.backbone) links.push(...this.backbone.links);
    return links;
  }

  sendRelayed(kind, payload) {
    if (!this.zone) return;
    const { bytes, id } = sealRelayed(kind, payload, this.zone.room.selfId);
    this.markOwn(id);
    new Set([this.zone.room, ...this.relayLinks(kind)]).forEach(link => link.send(bytes));
  }

  receive(link, bytes, from) {
    const message = open(bytes);
    if (!message) return;
    if (message.kind === KIND.ZONE) {
      if (link === this.zone?.room) this.onZoneMessage(message.payload, from);
      return;
    }
    if (!isRelayed(message.kind)) return;
    if (!this.delivered.has(message.id)) {
      this.delivered.add(message.id);
      this.deliver(message);
    }
    if (link === this.zone?.room && !this.isDelegate) return; // my room's delegate carries it out
    if (this.relayed.has(message.id)) return;
    this.relayed.add(message.id);
    for (const out of this.relayLinks(message.kind)) {
      if (out !== link) out.send(bytes);
    }
  }

  deliver(message) {
    if (message.kind === KIND.DIRECTORY) {
      const entry = readDirectory(message.payload);
      if (entry) this.directory.set(entry.shard, entry.members);
      return;
    }
    const deliver = { [KIND.WORLD]: this.onWorldMessage, [KIND.LEVEL]: this.onLevelMessage, [KIND.META]: this.onMetaMessage }[message.kind];
    deliver(message.payload, message.origin);
  }

  markOwn(id) {
    this.delivered.add(id);
    this.relayed.add(id);
  }
}
