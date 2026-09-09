// Feed browser keyboard events into the emulated CPC key matrix, so programs can
// read the keyboard at &F4xx. The caller decides what a key change does (set the
// matrix bit, record it for replay, or ignore it while reviewing history).
import { keyByName } from '../cpc';

export interface KeyboardOptions {
  /** Called on every key down/up that maps to a CPC matrix bit. */
  onKey(line: number, bit: number, down: boolean): void;
  /** True while the listing editor has focus, so its keystrokes are left alone. */
  isEditing?: () => boolean;
  /** True on a GX4000 — it has no keyboard, so the arrows and a couple of keys
   *  drive joystick 0 (matrix line 9) instead. */
  joypad?: () => boolean;
}

/** GX4000 pad -> joystick 0. Nothing to clash with; there is no keyboard. */
const JOYPAD: Record<string, readonly [number, number]> = {
  ArrowUp: [9, 0], ArrowDown: [9, 1], ArrowLeft: [9, 2], ArrowRight: [9, 3],
  Space: [9, 4], KeyX: [9, 4],       // fire 1
  KeyZ: [9, 5], ShiftRight: [9, 5],  // fire 2
};

export function attachKeyboard(opts: KeyboardOptions): void {
  const held = new Map<string, readonly [number, number]>();

  const resolve = (code: string): readonly [number, number] | null => {
    if (opts.joypad?.() && code in JOYPAD) return JOYPAD[code];
    return keyByName(code);
  };

  window.addEventListener('keydown', (e) => {
    if (opts.isEditing?.()) return;
    if (held.has(e.code)) return; // ignore auto-repeat
    const k = resolve(e.code);
    if (!k) return;
    held.set(e.code, k);
    opts.onKey(k[0], k[1], true);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });

  const release = (code: string) => {
    const k = held.get(code);
    if (k) { held.delete(code); opts.onKey(k[0], k[1], false); }
  };
  window.addEventListener('keyup', (e) => release(e.code));
  window.addEventListener('blur', () => { for (const c of [...held.keys()]) release(c); });
}
