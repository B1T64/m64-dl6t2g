// The event's host: whoever enters the host code as their name in the start menu.
// The code isn't in this site (the repository is public): only the public key of a
// signing key derived from it is. The host's page signs "open the castle" with that
// key, and every page checks the signature, so no one without the code can open it,
// however they change their own page. New code: ~/sm64web/loadtest/host_key.mjs.
import { loadVendor } from './vendor/vendor.js';

export const HOST_NAME = 'Snepy';
const HOST_PUBLIC_KEY = 'b47c8dafb649681363e98fea24c6b3810f61562839725013aac26fb84006e09a';

const encoder = new TextEncoder();
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => Uint8Array.from(hex.match(/../g) || [], pair => parseInt(pair, 16));
const isHex = (text, bytes) => typeof text === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(text);

// An opening lasts this long: the next event finds the castle shut again
const OPEN_CASTLE_HOURS = 12;

// What gets signed: the order, the world it applies to and when it ends, so it can't
// be replayed in another world or after it ends
const openCastleMessage = (world, until) => encoder.encode(`sm64web:open-castle:${world}:${until}`);

// Whether a name is shaped like a host code (right or wrong, it's no name to show)
export const looksLikeHostCode = name => name.trim().toLowerCase().startsWith('castillo-');

// Whether `key` (hex) is the current host's signing key; a key kept from an older
// code no longer is
export async function isHostKey(key) {
  if (!isHex(key, 32)) return false;
  const { schnorr } = await loadVendor();
  return toHex(schnorr.getPublicKey(fromHex(key))) === HOST_PUBLIC_KEY;
}

// The host's signing key (hex) if `code` is the host code, else null. Letter case
// doesn't matter. Keys derive as in host_key.mjs.
export async function hostKeyFromCode(code) {
  if (!looksLikeHostCode(code)) return null; // spare the hashing for ordinary names
  const secret = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`sm64web-host:${code.trim().toLowerCase()}`))));
  return await isHostKey(secret) ? secret : null;
}

// The host's order to open the castle of `world`: "<until>.<signature>", until being
// when the opening ends (ms since 1970)
export async function signOpenCastle(world, hostKey) {
  const until = Date.now() + OPEN_CASTLE_HOURS * 3600 * 1000;
  const { schnorr } = await loadVendor();
  return `${until}.${toHex(await schnorr.signAsync(openCastleMessage(world, until), fromHex(hostKey)))}`;
}

// When the order's opening ends, or 0 if it's not the host's or already over
export async function verifyOpenCastle(world, order) {
  const [untilText, signature] = String(order).split('.');
  const until = Number(untilText);
  if (!Number.isSafeInteger(until) || until <= Date.now() || !isHex(signature, 64)) return 0;
  const { schnorr } = await loadVendor();
  try {
    return await schnorr.verifyAsync(fromHex(signature), openCastleMessage(world, until), fromHex(HOST_PUBLIC_KEY)) ? until : 0;
  } catch {
    return 0;
  }
}
