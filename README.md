# batfink

An Amstrad CPC 464 emulator, Z80 assembler and playground that runs in the browser.

Type Z80 assembly in the editor and it assembles and runs as you go. Share a
listing by URL, save named revisions, load from the examples gallery, and
download the result as a snapshot, binary, disc or tape image.

## Before you start

Install Node.js 24. If you use nvm, run `nvm use`.

## Install

```
npm install
```

## Run locally

```
npm run dev
```

This starts the Vite dev server. Open the URL it prints.

## Test

```
npm test
```

## Build

```
npm run build
```

This type-checks the code and writes the site to `dist/`. To preview the built
site, run `npm run preview`.

## Hosting

Every push to `main` builds and deploys to
[stuaxo.github.io/batfink](https://stuaxo.github.io/batfink/) via GitHub Actions
(`.github/workflows/pages.yml`). It uses `npm run build:pages`, which sets the
base path to `/batfink/`. The repo's Pages source must be set to "GitHub
Actions".
