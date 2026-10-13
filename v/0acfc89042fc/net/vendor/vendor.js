// The bundled third-party networking code (p2p.js, see p2p_entry.mjs), loaded once
// and only when needed. The URL is made absolute from this module's own, so it
// can't be resolved against the page instead.
let vendor = null;
export function loadVendor() {
  vendor ??= import(new URL('./p2p.js', import.meta.url).href);
  return vendor;
}
