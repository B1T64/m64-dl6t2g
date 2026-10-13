// A room for leaders that stays small however many there are: members are seated
// `capacity` per shard (<base>:<n>), and the delegate of each shard also sits on
// <base>:spine, which joins the shards. Two levels hold capacity x capacity members.
// The owner relays through `links` (see world_topology.js); this class only keeps
// the seats and the spine in order.
import { ROLE, roster, hasSeat, roleIn, joinSeated } from './seating.js';
import { HeadCount, NO_BOARD } from './board.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class TreeBridge {
  // onMessage(link, bytes) gets everything heard on the shard room or the spine;
  // onShardJoin() is told when someone joins my shard
  constructor(joinRoom, base, options, { onMessage, onShardJoin = () => {} }) {
    this.joinRoom = joinRoom;
    this.base = base;
    this.options = { board: NO_BOARD, ...options }; // { capacity, maxShards, settleMs, board }
    this.headCount = new HeadCount(this.options.board);
    this.onMessage = onMessage;
    this.onShardJoin = onShardJoin;
    this.shard = null;   // { shard, room }
    this.spine = null;
    this.joining = false;
    this.version = 0;    // bumps on leave, so stale joins give up
  }

  get links() { return [this.shard?.room, this.spine].filter(Boolean); }
  get connectionCount() { return this.links.reduce((sum, room) => sum + room.peers().length, 0); }

  async join(firstShard = 0, full = []) {
    if (this.shard || this.joining) return;
    const version = this.version;
    this.joining = true;
    const seated = await joinSeated(this.joinRoom, this.base, {
      ...this.options, firstShard, full, isStale: () => version !== this.version,
    });
    this.joining = false;
    if (!seated) return;

    this.shard = seated;
    const room = seated.room;
    room.onMessage = bytes => this.onMessage(room, bytes);
    room.onPeerLeave = () => { this.updateSpine(); this.rebalanceSoon(room); };
    room.onPeerJoin = () => { this.updateSpine(); this.rebalanceSoon(room); this.onShardJoin(); };
    this.updateSpine();
    this.rebalanceSoon(room);
  }

  leave() {
    this.version++;
    this.shard?.room.leave();
    this.spine?.leave();
    this.shard = this.spine = null;
  }

  // The delegate of each shard sits on the spine
  updateSpine() {
    const onSpine = this.isShardDelegate;
    this.postHeadCount();
    if (onSpine && !this.spine) {
      const spine = this.joinRoom(`${this.base}:spine`);
      spine.onMessage = bytes => this.onMessage(spine, bytes);
      this.spine = spine;
    } else if (!onSpine && this.spine) {
      this.spine.leave();
      this.spine = null;
    }
  }

  get isShardDelegate() { return Boolean(this.shard) && roleIn(this.shard.room) === ROLE.DELEGATE; }

  // ...and keeps its head count on the seat board (call now and then, so it doesn't expire)
  postHeadCount() {
    if (this.isShardDelegate) this.headCount.update(this.base, this.shard.shard, roster(this.shard.room).length);
  }

  // Simultaneous arrivals can overfill a shard: the ones past capacity move on
  async rebalanceSoon(room) {
    await sleep(this.options.settleMs);
    if (this.shard?.room !== room || hasSeat(room, this.options.capacity)) return;
    const { shard } = this.shard;
    room.leave();
    this.shard = null;
    this.updateSpine();
    this.join(shard + 1, [shard]);
  }
}
