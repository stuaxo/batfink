// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { attachKeyboard } from '../../src/ui/keyboard';

const press = (code: string, type = 'keydown') =>
  window.dispatchEvent(new KeyboardEvent(type, { code }));

describe('attachKeyboard', () => {
  it('maps keys through the CPC matrix', () => {
    const onKey = vi.fn();
    attachKeyboard({ onKey });
    press('KeyA');
    expect(onKey).toHaveBeenLastCalledWith(8, 5, true);
    press('KeyA', 'keyup');
    expect(onKey).toHaveBeenLastCalledWith(8, 5, false);
  });

  it('routes arrows and X / Z to joystick 0 in joypad mode', () => {
    const onKey = vi.fn();
    attachKeyboard({ onKey, joypad: () => true });
    press('ArrowUp');
    expect(onKey).toHaveBeenLastCalledWith(9, 0, true);
    press('KeyX');
    expect(onKey).toHaveBeenLastCalledWith(9, 4, true);
    press('KeyZ');
    expect(onKey).toHaveBeenLastCalledWith(9, 5, true);
  });

  it('leaves the cursor keys alone outside joypad mode', () => {
    const onKey = vi.fn();
    attachKeyboard({ onKey, joypad: () => false });
    press('ArrowUp');
    expect(onKey).toHaveBeenLastCalledWith(0, 0, true);
  });

  it('ignores auto-repeat and releases held keys on blur', () => {
    const onKey = vi.fn();
    attachKeyboard({ onKey });
    press('KeyM');
    press('KeyM'); // auto-repeat
    expect(onKey.mock.calls.filter(([, , d]) => d).length).toBe(1);
    window.dispatchEvent(new Event('blur'));
    expect(onKey).toHaveBeenLastCalledWith(4, 6, false); // KeyM = line 4 bit 6
  });
});
