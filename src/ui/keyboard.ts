// Feed browser keyboard events into the emulated CPC key matrix, so programs can
// read the keyboard at &F4xx. The caller decides what a key change does (set the
// matrix bit, record it for replay, or ignore it while reviewing history).
import { keyByName } from '../cpc';

export interface KeyboardOptions {
  /** Called on every key down/up that maps to a CPC matrix bit. */
  onKey(line: number, bit: number, down: boolean): void;
  /** True while the listing editor has focus, so its keystrokes are left alone. */
  isEditing?: () => boolean;
}

export function attachKeyboard(opts: KeyboardOptions): void {
  const held = new Set<string>();
  const release = (code: string) => {
    const k = keyByName(code);
    if (k) opts.onKey(k[0], k[1], false);
  };

  window.addEventListener('keydown', (e) => {
    if (opts.isEditing?.()) return;
    const k = keyByName(e.code);
    if (!k) return;
    opts.onKey(k[0], k[1], true);
    held.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    release(e.code);
    held.delete(e.code);
  });
  window.addEventListener('blur', () => {
    held.forEach(release);
    held.clear();
  });
}
