// A yes/no question over the game, phone-friendly. onYes runs inside the tap on
// "yes", so it may start what browsers allow only from a tap (microphone, sound).
// Keys typed here stay out of the game.

const STYLE = `
  .web-dialog { position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55); font: 15px system-ui, sans-serif; color: #fff; }
  .web-dialog .box { max-width: min(90vw, 420px); padding: 18px; border-radius: 14px; background: #1d1d28;
    border: 1px solid rgba(255,255,255,.25); display: flex; flex-direction: column; gap: 14px; }
  .web-dialog .buttons { display: flex; gap: 10px; justify-content: flex-end; }
  .web-dialog button { padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,.4);
    background: rgba(255,255,255,.08); color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  .web-dialog button.yes { background: #2a7d3c; }
`;

let styled = false;

export function ask(question, yesLabel, onYes) {
  if (!styled) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    styled = true;
  }
  const dialog = document.createElement('div');
  dialog.className = 'web-dialog';
  dialog.innerHTML = '<div class="box"><div class="question"></div><div class="buttons"><button class="no">Cancelar</button><button class="yes"></button></div></div>';
  dialog.querySelector('.question').textContent = question;
  dialog.querySelector('.yes').textContent = yesLabel;
  dialog.addEventListener('keydown', e => e.stopPropagation());
  const close = () => dialog.remove();
  dialog.querySelector('.no').addEventListener('click', close);
  dialog.querySelector('.yes').addEventListener('click', () => { close(); onYes(); });
  document.body.appendChild(dialog);
  dialog.querySelector('.no').focus();
}
