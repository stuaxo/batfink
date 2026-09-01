// CPC key matrix: CPC_KEYS[line][bit] is the KeyboardEvent.code that pulls that
// matrix bit low. Ten lines of eight bits; line 9 is the joystick.
export const CPC_KEYS: readonly (readonly string[])[] = [
  ['ArrowUp', 'ArrowRight', 'ArrowDown', 'F9', 'F6', 'F3', 'NumpadEnter', 'NumpadDecimal'],
  ['ArrowLeft', 'Numpad5', 'F7', 'F8', 'F5', 'F1', 'F2', 'F0'],
  ['Clr', 'BracketLeft', 'Enter', 'BracketRight', 'F4', 'ShiftLeft', 'Backslash', 'ControlLeft'],
  ['Caret', 'Minus', 'At', 'KeyP', 'Semicolon', 'Colon', 'Slash', 'Period'],
  ['Digit0', 'Digit9', 'KeyO', 'KeyI', 'KeyL', 'KeyK', 'KeyM', 'Comma'],
  ['Digit8', 'Digit7', 'KeyU', 'KeyY', 'KeyH', 'KeyJ', 'KeyN', 'Space'],
  ['Digit6', 'Digit5', 'KeyR', 'KeyT', 'KeyG', 'KeyF', 'KeyB', 'KeyV'],
  ['Digit4', 'Digit3', 'KeyE', 'KeyW', 'KeyS', 'KeyD', 'KeyC', 'KeyX'],
  ['Digit1', 'Digit2', 'Escape', 'KeyQ', 'Tab', 'KeyA', 'CapsLock', 'KeyZ'],
  ['JoyUp', 'JoyDown', 'JoyLeft', 'JoyRight', 'JoyFire1', 'JoyFire2', 'JoySpare', 'Delete'],
];

/** [line, bit] for a KeyboardEvent.code, or null if it is not on the matrix. */
export function keyByName(name: string): [number, number] | null {
  for (let l = 0; l < CPC_KEYS.length; l++) {
    const b = CPC_KEYS[l].indexOf(name);
    if (b >= 0) return [l, b];
  }
  return null;
}
