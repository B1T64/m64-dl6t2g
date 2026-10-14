// The bundled third-party networking code (p2p.js, see p2p_entry.mjs), loaded once
// and only when needed. The URL is made absolute from this module's own, so it
// can't be resolved against the page instead.
// A failed download (a phone losing signal) must not stick: the failure isn't kept,
// and since browsers remember a module URL that failed, each retry asks for p2p.js
// under a new one.
let vendor = null;
let failures = 0;

export function loadVendor() {
  if (!vendor) {
    const url = new URL(failures ? `./p2p.js?retry=${failures}` : './p2p.js', import.meta.url).href;
    vendor = import(url).catch(err => {
      vendor = null;
      failures++;
      throw err;
    });
  }
  return vendor;
}
