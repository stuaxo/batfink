// CodeMirror editor for the listing: Z80 highlighting, error underlines wired to
// the assembler's line numbers, and completion for mnemonics and the program's
// own labels.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { z80 } from '@codemirror/legacy-modes/mode/z80';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

export interface BuildError {
  line: number;
  message: string;
}

export interface EditorHandle {
  getValue(): string;
  setValue(source: string): void;
  setErrors(errors: BuildError[]): void;
  setSymbols(names: string[]): void;
  hasFocus(): boolean;
  focus(): void;
}

const MNEMONICS = (
  'adc add and bit call ccf cp cpd cpdr cpi cpir cpl daa dec di djnz ei ex exx ' +
  'halt im in inc ind indr ini inir jp jr ld ldd lddr ldi ldir neg nop or otdr ' +
  'otir out outd outi pop push res ret reti retn rl rla rlc rlca rld rr rra rrc ' +
  'rrca rrd rst sbc scf set sla sll sra srl sub xor ' +
  'org equ db defb dw defw ds defs align end'
).split(' ');

const paper = EditorView.theme({
  '&': { color: '#2f3330', backgroundColor: 'transparent', fontSize: '12.5px' },
  '.cm-content': {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace',
    padding: '4px 0',
  },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#9a9784' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: '2px solid #0080ff', outlineOffset: '-2px' },
}, { dark: false });

export function createEditor(opts: {
  parent: HTMLElement;
  doc: string;
  onChange: () => void;
}): EditorHandle {
  let symbols: string[] = [];

  const complete = (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[A-Za-z_.@][\w.@]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return {
      from: word.from,
      options: [
        ...MNEMONICS.map((label) => ({ label, type: 'keyword' })),
        ...symbols.map((label) => ({ label, type: 'variable' })),
      ],
    };
  };

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        StreamLanguage.define(z80),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        lintGutter(),
        autocompletion({ override: [complete] }),
        paper,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange();
        }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),
    setValue(source) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    },
    setErrors(errors) {
      const diags: Diagnostic[] = [];
      for (const e of errors) {
        if (e.line < 1 || e.line > view.state.doc.lines) continue;
        const line = view.state.doc.line(e.line);
        diags.push({ from: line.from, to: line.to, severity: 'error', message: e.message });
      }
      view.dispatch(setDiagnostics(view.state, diags));
    },
    setSymbols(names) {
      symbols = names;
    },
    hasFocus: () => view.hasFocus,
    focus: () => view.focus(),
  };
}

export type EditorFactory = typeof createEditor;
