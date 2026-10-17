// Only the official site joins the shared world. The site's files are public, so anyone
// can host a copy (or keep an old one); a copy elsewhere plays alone, and says so.
// Someone rewriting the code could still get past this: it stops copies, not attacks.
// Moving the site (renaming the repo) means updating OFFICIAL_SITES.

const OFFICIAL_SITES = [
  'https://b1t64.github.io/m64-dl6t2g/',
];
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']; // testing on this computer

export function isOfficialSite(location = globalThis.location) {
  if (LOCAL_HOSTS.includes(location.hostname)) return true;
  const here = `${location.origin}${location.pathname}`;
  return OFFICIAL_SITES.some(site => here.startsWith(site));
}
