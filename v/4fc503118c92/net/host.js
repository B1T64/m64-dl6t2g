// The event's host: whoever enters the host code as their name in the start menu.
// The code isn't in this site (the repository is public): only the public key of a
// signing key derived from it is. The host's page signs its orders ("open the castle",
// "close the castle") with that key, and every page checks the signature, so no one
// without the code can give them, however they change their page.
// New code: ~/sm64web/loadtest/host_key.mjs.
import { loadVendor } from './vendor/vendor.js';

export const HOST_NAME = 'Snepy';
const HOST_PUBLIC_KEY = 'b47c8dafb649681363e98fea24c6b3810f61562839725013aac26fb84006e09a';

const encoder = new TextEncoder();
const toHex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => Uint8Array.from(hex.match(/../g) || [], pair => parseInt(pair, 16));
const isHex = (text, bytes) => typeof text === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(text);

export const CASTLE = { OPEN: 'open', CLOSE: 'close' };

// An opening lasts this long: the next event finds the castle shut again
const OPEN_CASTLE_MS = 12 * 3600 * 1000;
// how far ahead of mine another clock may run (an order "from the future" beyond it is refused)
const CLOCK_SKEW_MS = 10 * 60 * 1000;

// What gets signed: the order, the world it applies to and when it was given, so it
// can't be replayed in another world, and the newest order wins over older ones
const castleMessage = (world, action, at) => encoder.encode(`sm64web:castle:${world}:${action}:${at}`);

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

// The host's order to open or close the castle of `world`: "<action>.<at>.<signature>",
// at being when it was given (ms since 1970)
export async function signCastleOrder(world, action, hostKey) {
  const at = Date.now();
  return `${action}.${at}.${await signHost(castleMessage(world, action, at), hostKey)}`;
}

// { action, at } if the order is the host's, else null
export async function verifyCastleOrder(world, order) {
  const [action, atText, signature] = String(order).split('.');
  const at = Number(atText);
  if (!Object.values(CASTLE).includes(action) || !Number.isSafeInteger(at) || at > Date.now() + CLOCK_SKEW_MS) return null;
  return await verifyHost(signature, castleMessage(world, action, at)) ? { action, at } : null;
}

// The host's signature (hex) of `message`
async function signHost(message, hostKey) {
  const { schnorr } = await loadVendor();
  return toHex(await schnorr.signAsync(message, fromHex(hostKey)));
}

// Whether `signature` (hex) is the host's for `message`
async function verifyHost(signature, message) {
  if (!isHex(signature, 64)) return false;
  const { schnorr } = await loadVendor();
  try {
    return await schnorr.verifyAsync(fromHex(signature), message, fromHex(HOST_PUBLIC_KEY));
  } catch {
    return false;
  }
}

// "I, <id>, am the host here": "<at>.<signature>", fresh for a few minutes
const HOST_PRESENCE_FRESH_MS = 5 * 60 * 1000;
const hostPresenceMessage = (world, id, at) => encoder.encode(`sm64web:host-presence:${world}:${id}:${at}`);

export async function signHostPresence(world, id, hostKey) {
  const at = Date.now();
  return `${at}.${await signHost(hostPresenceMessage(world, id, at), hostKey)}`;
}

export async function verifyHostPresence(world, id, signed) {
  const [atText, signature] = String(signed).split('.');
  const at = Number(atText);
  if (!Number.isSafeInteger(at) || Math.abs(Date.now() - at) > HOST_PRESENCE_FRESH_MS) return false;
  return verifyHost(signature, hostPresenceMessage(world, id, at));
}

// Whether that order leaves the castle open now: an opening runs out after some hours
export const castleOpenBy = order => order?.action === CASTLE.OPEN && Date.now() < order.at + OPEN_CASTLE_MS;
