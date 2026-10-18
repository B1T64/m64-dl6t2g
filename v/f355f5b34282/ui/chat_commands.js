// Chat commands on the web: whatever starts with "/" in the game's chat (or the phone's
// chat box) comes here (src/pc/web/web_chat.c) instead of coop's own commands, and the
// answer goes back into the chat, only for this player. The host's powers are commands,
// not buttons, so nothing happens by a stray tap:
//   /OpenCastle  /CloseCastle            the castle's front door (net/castle_gate.js)
//   /Ban <name> <time>  /PermaBan <name>  out of the world (net/kicks.js); /Unban <name>
//   /Ver <n>                              how many players the host draws (view_limit.js)
//   /Help                                 the list (everyone)
import { FOREVER } from '../net/kicks.js';
import { VIEW, saveHostView } from './view_limit.js';

const UNITS = [ // [words, ms]
  [['s', 'seg', 'segundo', 'segundos'], 1000],
  [['m', 'min', 'minuto', 'minutos'], 60000],
  [['h', 'hora', 'horas'], 3600000],
  [['d', 'dia', 'día', 'dias', 'días'], 86400000],
];

// "15 minutos", "15m", "2h", "1 dia" -> ms; a bare number means minutes; null if unreadable
export function parseDuration(words) {
  const text = words.join(' ').trim().toLowerCase();
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*([a-zíá]*)$/);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2] ? UNITS.find(([names]) => names.includes(match[2])) : UNITS[1];
  return unit && amount > 0 ? amount * unit[1] : null;
}

const describe = ms => {
  for (const [names, size] of [...UNITS].reverse()) {
    if (ms >= size && ms % size === 0) return `${ms / size} ${names[names.length - 1]}`;
  }
  return `${Math.round(ms / 1000)} segundos`;
};

const HELP_ALL = ['Comandos: /Help'];
const HELP_HOST = [
  'Anfitrión:',
  '/OpenCastle  /CloseCastle',
  '/Ban <nombre> <tiempo> (ej. 15 minutos, 2h)',
  '/PermaBan <nombre>   /Unban <nombre>',
  `/Ver <1-${VIEW.hostMax}> (jugadores que ves)`,
];

// hub: the page's transport (castle, kicks); say(text): a chat line for this player only
export function startChatCommands({ hub, hostKey, say, setView }) {
  const hostOnly = handler => (args, name) => (hostKey ? handler(args) : say(`Solo el anfitrión puede usar /${name}.`));
  const needWorld = handler => args => (hub ? handler(args) : say('Sin mundo compartido: el comando no tiene efecto.'));

  // ms: how long, or null for good
  const ban = async (name, ms, usage) => {
    if (!name) { say(`Falta el nombre: ${usage}`); return; }
    const used = await hub.kicks.orderAsHost(name, ms === null ? FOREVER : Date.now() + ms, hostKey);
    say(ms === null ? `${used} expulsado para siempre.` : `${used} expulsado por ${describe(ms)}.`);
  };

  const COMMANDS = {
    help: () => [...HELP_ALL, ...(hostKey ? HELP_HOST : [])].forEach(say),
    opencastle: hostOnly(needWorld(async () => say(await hub.castle.openAsHost(hostKey) ? 'Castillo abierto.' : 'No se pudo abrir el castillo.'))),
    closecastle: hostOnly(needWorld(async () => say(await hub.castle.closeAsHost(hostKey) ? 'Castillo cerrado: todos vuelven a los jardines.' : 'No se pudo cerrar el castillo.'))),
    ban: hostOnly(needWorld(([name, ...time]) => {
      const ms = parseDuration(time);
      if (name && ms === null) { say('Tiempo no válido. Ej.: /Ban Fulano 15 minutos'); return; }
      return ban(name, ms, '/Ban <nombre> <tiempo>');
    })),
    permaban: hostOnly(needWorld(([name]) => ban(name, null, '/PermaBan <nombre>'))),
    unban: hostOnly(needWorld(async ([name]) => {
      if (!name) { say('Falta el nombre: /Unban <nombre>'); return; }
      say(`${await hub.kicks.orderAsHost(name, 1, hostKey)} ya puede volver.`); // a ban that ended long ago
    })),
    ver: hostOnly(([n]) => {
      if (!Number.isFinite(Number(n))) { say(`Uso: /Ver <1-${VIEW.hostMax}>`); return; }
      const view = saveHostView(Number(n));
      setView(view);
      say(`Ahora ves hasta ${view} jugadores.`);
    }),
  };

  return line => {
    const [word, ...args] = line.trim().slice(1).split(/\s+/);
    const command = COMMANDS[lower(word)];
    if (!command) { say(`Comando desconocido: /${word ?? ''} (/Help)`); return; }
    Promise.resolve(command(args, word)).catch(err => { console.warn('chat command failed:', err); say('El comando falló.'); });
  };
}

const lower = text => String(text ?? '').toLowerCase();
