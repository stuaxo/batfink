// Fetches the firmware ROM assets once per machine and hands back their bytes.
// The images live in ../cpc/roms and are bundled by Vite as URL assets.
import rom464Url from '../cpc/roms/cpc464.rom?url';
import rom6128Url from '../cpc/roms/cpc6128.rom?url';
import amsdosUrl from '../cpc/roms/amsdos.rom?url';

export type FirmwareKind = 'cpc464' | 'cpc6128';

export interface FirmwareRoms {
  rom: Uint8Array;
  amsdos: Uint8Array;
}

const pending: Partial<Record<FirmwareKind, Promise<FirmwareRoms>>> = {};

export function loadFirmwareRoms(kind: FirmwareKind): Promise<FirmwareRoms> {
  if (!pending[kind]) {
    const osUrl = kind === 'cpc6128' ? rom6128Url : rom464Url;
    const get = (u: string) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.arrayBuffer();
    });
    pending[kind] = Promise.all([get(osUrl), get(amsdosUrl)])
      .then(([rom, amsdos]) => ({ rom: new Uint8Array(rom), amsdos: new Uint8Array(amsdos) }))
      .catch((e) => { delete pending[kind]; throw e; });
  }
  return pending[kind]!;
}
