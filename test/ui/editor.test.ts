// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createEditor } from '../../src/ui/editor';

describe('CodeMirror editor', () => {
  it('mounts, round-trips text and reports focus state', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let changes = 0;
    const ed = createEditor({ parent, doc: 'org &4000\nstart:\n  ret\n', onChange: () => changes++ });

    expect(parent.querySelector('.cm-content')).not.toBeNull();
    expect(ed.getValue()).toContain('org &4000');

    ed.setValue('  nop\n');
    expect(ed.getValue()).toBe('  nop\n');
    expect(changes).toBeGreaterThan(0);
    expect(ed.hasFocus()).toBe(false);

    expect(() => ed.setErrors([{ line: 1, message: 'boom' }])).not.toThrow();
    expect(() => ed.setSymbols(['START', 'LOOP'])).not.toThrow();
  });

  it('shows T-state costs in a gutter', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const ed = createEditor({ parent, doc: 'nop\nld a,1\n', onChange: () => {} });
    ed.setTiming(new Map([[1, '4'], [2, '12/8']]));
    const gutter = parent.querySelector('.cm-tstates');
    expect(gutter).not.toBeNull();
    expect(gutter!.textContent).toContain('4');
    expect(gutter!.textContent).toContain('12/8');
  });
});
