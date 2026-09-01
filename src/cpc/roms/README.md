# Firmware ROMs

Standard Amstrad CPC firmware images, as shipped with every CPC emulator.

| File | Size | Contents | sha256 |
| --- | --- | --- | --- |
| `cpc464.rom` | 32K | lower 16K = OS 1.0, upper 16K = BASIC 1.0 | `00960d9b…5d37b15e` |
| `amsdos.rom` | 16K | AMSDOS (DDI-1 disc OS), seen as upper ROM 7 | `ea65e0fb…469fa04d` |

## Licence

Copyright Amstrad plc and Locomotive Software.

Amstrad has long permitted the CPC and Spectrum ROM images to be redistributed
with emulators, provided the copyright message in the ROM is not altered and the
images are supplied free of charge. This is the same permission every other CPC
emulator relies on. See the project `NOTICE` file.

## Loading

`src/cpc/roms.ts` splits `cpc464.rom` into the two 16K halves and installs them
via `installFirmware(machine, bytes)`. The paging mechanism is in
`src/cpc/rom.ts`.
