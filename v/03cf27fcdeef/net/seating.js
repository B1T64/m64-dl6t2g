// Rooms with a limited number of seats, spread over numbered shards <base>:<n>.
// Seats go to the first `capacity` ids of a room's roster, and the first two of
// them lead it (delegate, then deputy). Everyone sees the same roster, so they
// all agree without voting, and a crowd arriving at once splits cleanly. Leaders
// post their room's head count to a seat board, when there is one, so newcomers
// can go straight to a free seat.

export const ROLE = { DELEGATE: 'delegate', DEPUTY: 'deputy', MEMBER: 'member' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function roster(room) {
  return [room.selfId, ...room.peers()].sort();
}

export function hasSeat(room, capacity) {
  return roster(room).indexOf(room.selfId) < capacity;
}

export function roleIn(room) {
  const rank = roster(room).indexOf(room.selfId);
  return rank === 0 ? ROLE.DELEGATE : rank === 1 ? ROLE.DEPUTY : ROLE.MEMBER;
}

// A shard for a newcomer, from a seat board's snapshot (see board.js): one with free
// seats, picked at random in proportion to them, so a crowd reading the same snapshot
// spreads out instead of piling into one room. Fresh shards past the known ones open
// as needed to seat everyone arriving along with me. Shards in `full` are skipped.
//
// Only a real crowd spreads out: "arriving" counts everyone who came lately, including
// those already seated (and counted in their room), so it overstates. Unless the
// arrivals overflow the free seats by more than a whole room, the lowest shard with a
// seat is the pick, which keeps a group of friends together; a room overfilled by a
// burst sheds its extras (rebalanceSoon) one shard up.
export function chooseShard({ occupancy, arriving = 0 }, { capacity, maxShards }, full = new Set(), random = Math.random) {
  const known = [...occupancy.keys()];
  const top = known.length ? Math.max(...known) : -1;
  const open = []; // [shard, free seats]
  let seats = 0;
  const offer = (shard, free) => { if (free > 0 && !full.has(shard)) { open.push([shard, free]); seats += free; } };
  for (let shard = 0; shard <= top && shard < maxShards; shard++) offer(shard, capacity - (occupancy.get(shard) ?? 0));

  const crowd = arriving + 1 - seats > capacity;
  if (!crowd) {
    if (open.length) return open[0][0];
    for (let shard = top + 1; shard < maxShards; shard++) if (!full.has(shard)) return shard;
    return maxShards - 1;
  }
  for (let shard = top + 1; seats < arriving + 1 && shard < maxShards; shard++) offer(shard, capacity);
  if (seats === 0) return maxShards - 1;
  let pick = random() * seats;
  for (const [shard, free] of open) if ((pick -= free) < 0) return shard;
  return open[open.length - 1][0];
}

// Joins a shard that seats me after `settleMs`: with a ready board, as chooseShard
// suggests (skipping `full`), else the first one from `firstShard` on.
// Gives up (returns null) when isStale() turns true, e.g. because I moved on.
export async function joinSeated(joinRoom, base, { firstShard = 0, full = [], capacity, maxShards, settleMs, isStale, board }) {
  const guided = board?.ready;
  const tried = new Set(full);
  let snapshot = null;
  if (guided) {
    board.arrive(base);
    snapshot = await board.read(base);
  }
  for (let next = firstShard; next < maxShards; next++) {
    if (isStale()) return null;
    const shard = guided ? chooseShard(snapshot, { capacity, maxShards }, tried) : next;
    const room = joinRoom(`${base}:${shard}`);
    await sleep(settleMs);
    if (isStale()) { room.leave(); return null; }
    if (hasSeat(room, capacity) || shard === maxShards - 1) return { shard, room };
    room.leave();
    tried.add(shard);
  }
  return null;
}
