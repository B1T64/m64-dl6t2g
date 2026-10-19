// The world starts over once everyone has left. Its progress lives only in players'
// save files, so "starting over" means: whoever arrives at an empty world deletes
// their save, and so does anyone arriving later with a save from an older life.
//
// A life is a generation id ("<when it began>.<random>"). While anyone plays, room
// delegates keep it posted on the seat board (board.js), where it expires `gone`
// seconds after the last post: no post means nobody's there. Arriving, a page reads it:
//   posted, and my save is from it     keep my save
//   posted, my save is from another    delete my save, join this life
//   nothing posted                     the world emptied: delete my save, begin a new life
// Without a board (or if the page started the game before reading it) nothing is
// decided: the save stays, and this page stays out of the life's bookkeeping.
// Two pages starting a life at once each post their own; delegates also tell the
// world theirs (META.LIFE), and everyone settles on the oldest, keeping their save
// (whatever was played meanwhile spreads between pages like any progress).
import { META } from './meta_channel.js';
import { every } from './ticker.js';

const DEFAULTS = {
  gone: 60,           // seconds: a life not posted for this long ended (everyone left)
  repostMs: 20000,    // how often delegates post it, on the board and to the world
};
const storeKey = world => `sm64web.life.${world}`;
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

const newLife = () => `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
const bornAt = life => Number(String(life).split('.')[0]);
const isLife = life => typeof life === 'string' && /^\d{13}\.[a-z0-9]{1,8}$/.test(life);

export class WorldLife {
  constructor(topology, meta, board, options = {}) {
    this.topology = topology;
    this.meta = meta;
    this.board = board;
    this.options = { ...DEFAULTS, ...options };
    this.life = storage.get(storeKey(topology.world)); // the life my save belongs to
    this.decided = false; // whether this visit checked it against the world's
    meta.on(META.LIFE, text => this.heard(text));
    this.stopReposts = every(this.options.repostMs, () => this.repost());
  }

  get boardKey() { return `${this.topology.world}:life`; }

  // On arrival, before the game reads the save: whether to delete it. Past `deadline`
  // (ms since 1970) the game has started with the save as it was: nothing is decided.
  async arrive(deadline = Infinity) {
    if (!this.board.ready) return { wipe: false };
    const posted = await this.board.readNote(this.boardKey);
    if (Date.now() > deadline) return { wipe: false };
    if (isLife(posted)) {
      const wipe = posted !== this.life;
      this.adopt(posted);
      return { wipe };
    }
    this.adopt(newLife());
    this.board.postNote(this.boardKey, this.life, this.options.gone);
    return { wipe: true };
  }

  adopt(life) {
    this.life = life;
    this.decided = true;
    storage.set(storeKey(this.topology.world), life);
  }

  // a delegate keeps the life posted, and tells the world which one it is
  repost() {
    if (!this.decided || !this.topology.isDelegate) return;
    this.board.postNote(this.boardKey, this.life, this.options.gone);
    this.meta.send(META.LIFE, this.life);
  }

  heard(text) {
    if (this.decided && isLife(text) && bornAt(text) < bornAt(this.life)) this.adopt(text);
  }
}
