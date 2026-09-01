// Fetches the firmware ROM assets once and hands back their bytes. The images
// live in ../cpc/roms and are bundled by Vite as URL assets.
import romUrl from '../cpc/roms/cpc464.rom?url';
import amsdosUrl from '../cpc/roms/amsdos.rom?url';

export interface FirmwareRoms {
  rom: Uint8Array;
  amsdos: Uint8Array;
}

let pending: Promise<FirmwareRoms> | null = null;

export function loadFirmwareRoms(): Promise<FirmwareRoms> {
  if (!pending) {
    const get = (u: string) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.arrayBuffer();
    });
    pending = Promise.all([get(romUrl), get(amsdosUrl)])
      .then(([rom, amsdos]) => ({ rom: new Uint8Array(rom), amsdos: new Uint8Array(amsdos) }))
      .catch((e) => { pending = null; throw e; });
  }
  return pending;
}
