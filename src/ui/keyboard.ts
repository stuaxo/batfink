// Feed browser keyboard events into the emulated CPC key matrix, so programs can
// read the keyboard at &F4xx.
import type { CPCMachine } from '../cpc';

/**
 * @param machine     the running machine
 * @param isEditing   returns true while the listing editor has focus, so its
 *                    keystrokes are left alone
 */
export function attachKeyboard(machine: CPCMachine, isEditing?: () => boolean): void {
  const held = new Set<string>();
  const release = (code: string) => {
    const k = machine.keyByName(code);
    if (k) machine.setKey(k[0], k[1], false);
  };

  window.addEventListener('keydown', (e) => {
    if (isEditing?.()) return;
    const k = machine.keyByName(e.code);
    if (!k) return;
    machine.setKey(k[0], k[1], true);
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
