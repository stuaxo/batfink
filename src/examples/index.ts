// Starter listings for the gallery. Each is a whole program: assemble it and it
// runs. Loading one is the same path as loading a shared link.
import mode1 from './mode1.asm?raw';
import mode0 from './mode0.asm?raw';
import mode2 from './mode2.asm?raw';
import sprite from './sprite.asm?raw';
import scroller from './scroller.asm?raw';
import keyboard from './keyboard.asm?raw';
import sound from './sound.asm?raw';
import { DEMO_SOURCE } from '../demo';

export interface Example {
  id: string;
  title: string;
  source: string;
}

export const EXAMPLES: readonly Example[] = [
  { id: 'mode1', title: 'Mode 1 — four inks', source: mode1 },
  { id: 'mode0', title: 'Mode 0 — sixteen inks', source: mode0 },
  { id: 'mode2', title: 'Mode 2 — high resolution', source: mode2 },
  { id: 'sprite', title: 'Sprite — XOR block', source: sprite },
  { id: 'scroller', title: 'Scroller — hardware scroll', source: scroller },
  { id: 'keyboard', title: 'Keyboard — arrow keys', source: keyboard },
  { id: 'sound', title: 'Sound — a tune on the AY', source: sound },
  { id: 'raster', title: 'Raster State of Mind — full demo', source: DEMO_SOURCE },
];
