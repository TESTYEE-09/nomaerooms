// The ship terminal: a full-screen CRT overlay with a typed command line.
// Pure DOM — game logic stays in main.js, which provides getState() and the
// onRoute / onBuy callbacks.

import { MOONS, COMPANY_IDX, SELL_RATE, FLASHLIGHT_PRICE } from '../core/config.js';

const BOOT = [
  'NOMAE OS v5.1 — PROPERTY OF THE COMPANY',
  'unauthorized use is mandatory.',
  '',
  'type HELP for commands.',
];

export class Terminal {
  constructor() {
    this.el = document.getElementById('terminal');
    this.log = document.getElementById('term-log');
    this.input = document.getElementById('term-input');
    this.open = false;

    this.getState = null;   // () => {phase, moonIdx, routed, day, daysLeft, quota, sold, money, shipValue, remaining}
    this.onRoute = null;    // (moonIdx)
    this.onBuy = null;      // ('flashlight')
    this.onClose = null;

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const cmd = this.input.value.trim();
        this.input.value = '';
        if (cmd) this.exec(cmd);
      } else if (e.key === 'Escape') {
        this.hide();
      }
    });
    this.el.addEventListener('click', (e) => {
      const moon = e.target?.dataset?.moon;
      if (moon !== undefined) this.exec('route ' + moon);
      this.input.focus();
    });
  }

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.log.innerHTML = '';
    for (const l of BOOT) this.print(l);
    this._status();
    this.input.value = '';
    setTimeout(() => this.input.focus(), 30);
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    this.input.blur();
    this.onClose?.();
  }

  print(text, cls = '') {
    const div = document.createElement('div');
    div.className = 'term-line ' + cls;
    div.textContent = text;
    this.log.appendChild(div);
    this.log.scrollTop = this.log.scrollHeight;
  }

  printHTML(html) {
    const div = document.createElement('div');
    div.className = 'term-line';
    div.innerHTML = html;
    this.log.appendChild(div);
    this.log.scrollTop = this.log.scrollHeight;
  }

  _status() {
    const s = this.getState();
    this.print('');
    this.print(`day ${s.day} · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} until deadline`, 'dim');
    this.print(`quota: $${s.sold} / $${s.quota} sold · credits: $${s.money}`, 'dim');
    this.print(`scrap aboard ship: $${s.shipValue}`, 'dim');
  }

  exec(raw) {
    this.print('> ' + raw, 'cmd');
    const [cmd, ...args] = raw.toLowerCase().split(/\s+/);
    const s = this.getState();

    switch (cmd) {
      case 'help':
        this.print('MOONS            list destinations');
        this.print('ROUTE <name>     set course (pull the lever to fly)');
        this.print('STORE            company store');
        this.print('BUY FLASHLIGHT   $' + FLASHLIGHT_PRICE);
        this.print('SCAN             scrap remaining on this moon');
        this.print('STATUS           quota / credits');
        this.print('EXIT             close terminal');
        break;

      case 'moons': {
        this.print('— destinations —');
        MOONS.forEach((M, i) => {
          const tag = i === COMPANY_IDX ? ' [SELL HERE]' : '';
          const here = s.moonIdx === i && s.phase !== 'orbit' ? ' (you are here)' : '';
          const routed = s.routed === i ? ' ◄ routed' : '';
          this.printHTML(
            `<span class="term-moon" data-moon="${i}">${M.name}</span>` +
            ` — ${M.desc}${tag}${here}${routed}`);
        });
        this.print('click a name or ROUTE <name>', 'dim');
        break;
      }

      case 'route': {
        const q = args.join(' ');
        let idx = -1;
        if (/^\d+$/.test(q)) idx = +q;
        else idx = MOONS.findIndex((M) => M.name.toLowerCase().includes(q) || M.id.startsWith(q));
        if (idx < 0 || idx >= MOONS.length || !q) {
          this.print('unknown moon. try MOONS.', 'err');
          break;
        }
        if (s.phase !== 'orbit') {
          this.print('cannot reroute while landed. take off first.', 'err');
          break;
        }
        this.onRoute?.(idx);
        this.print(`course set: ${MOONS[idx].name}. pull the lever to descend.`, 'ok');
        break;
      }

      case 'store':
        this.print('— company store —');
        this.print(`FLASHLIGHT — $${FLASHLIGHT_PRICE} (BUY FLASHLIGHT)`);
        break;

      case 'buy': {
        if (args[0] === 'flashlight') {
          this.onBuy?.('flashlight');
        } else {
          this.print('we do not stock that.', 'err');
        }
        break;
      }

      case 'scan':
        if (s.phase === 'landed' && s.remaining > 0) {
          this.print(`scan: ~$${s.remaining} of scrap remains on this moon.`, 'ok');
        } else if (s.phase === 'landed') {
          this.print('scan: nothing of value detected.', 'dim');
        } else {
          this.print('scan requires boots on the ground.', 'err');
        }
        break;

      case 'status':
        this._status();
        this.print(`sell rate today: ${Math.round((SELL_RATE[Math.max(0, Math.min(3, s.daysLeft))] || 1) * 100)}% at the Company`, 'dim');
        break;

      case 'exit': case 'quit': case 'q':
        this.hide();
        break;

      default:
        this.print(`unknown command: ${cmd}. try HELP.`, 'err');
    }
  }
}
