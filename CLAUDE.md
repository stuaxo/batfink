# batfink

Amstrad CPC 464 emulator, Z80 assembler and browser playground. TypeScript, Vite, Vitest. Deployed as static assets on Cloudflare Workers.

## Commands

- `npm run dev` — Vite dev server
- `npm test` — run tests once (`npm run test:watch` to watch)
- `npm run build` — type-check, then build to `dist/`
- `npm run typecheck` — type-check only
- `npm run deploy` — build and `wrangler deploy`
- `npm run test:integration` — opt-in checks against real Z80 test suites and
  assemblers; not part of `npm test`. See `test/integration/README.md`.

Use Node 24 (`nvm use`).

## Layout

- `src/z80/` — Z80 CPU core and bus. DOM-free.
- `src/cpc/` — CPC hardware model: memory, ports, video, frame loop, SNA snapshots. DOM-free. Public surface is `src/cpc/index.ts`.
- `src/asm/` — two-pass Z80 assembler. Public surface is `src/asm/index.ts`; `expr`, `operands`, `encode` are internal.
- `src/export/` — file formats for the download menu: AMSDOS header, `.dsk`, `.cdt`. DOM-free.
- `src/examples/` — starter listings for the gallery (`.asm` + an index).
- `src/ui/` — DOM glue for the playground. The only code that touches the page. Includes the CodeMirror editor, share links, revisions, capture.
- `src/demo/` — demo listing shown in the editor on load.
- `test/` — mirrors `src/`. Tests run in Node; the DOM-free cores need no browser. UI tests use happy-dom.
- `test/integration/` — opt-in suite with its own config and `tsconfig`; excluded from `npm test` and `tsc`. Fixtures are fetched, not committed.

## Conventions

- Keep the emulator and assembler cores DOM-free. Browser code stays in `src/ui/`.
- Comments explain what is not obvious from the code. No signpost or narration comments.
- `strict` TypeScript, no unused locals or parameters.

## Writing

Docs and commit messages: succinct, plain English, active voice. Follow GOV.UK style, shorter. Say what the reader needs and stop.
