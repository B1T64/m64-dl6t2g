// Resetting the world: bump WORLD_EPOCH and publish. A shared world has no server
// to wipe: its progress lives in every player's save file and spreads from page to
// page. So on its first load of a new epoch, each page deletes its save file (stars,
// keys, doors), and every room name carries the epoch, so pages still running an
// older epoch never meet the new world to hand the old progress back.

export const WORLD_EPOCH = 2;

const STORE_KEY = 'sm64web.epoch';

// The world name rooms are built from (net/peer_transport.js)
export const worldName = room => `${room}~${WORLD_EPOCH}`;

// True when this browser hasn't played this epoch yet; remembers that it now has
export function isNewEpoch() {
  let seen = null;
  try { seen = localStorage.getItem(STORE_KEY); } catch {}
  if (seen === String(WORLD_EPOCH)) return false;
  try { localStorage.setItem(STORE_KEY, String(WORLD_EPOCH)); } catch {}
  return true;
}
