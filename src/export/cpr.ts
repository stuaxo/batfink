// Wrap an assembled binary as a bootable one-block cartridge (.cpr), for
// running the current listing on the GX4000 / a Plus. Not a general authoring
// format — just a stub in block 0 that stages the payload and jumps to it.
import { writeCpr } from '../cpc';

export interface CprMeta {
  loadAddr: number;
  /** Defaults to loadAddr. */
  entryAddr?: number;
}

const BLOCK = 0x4000;

/** Block 0 holds a short stub — copy the payload to its load address, then jump
 *  to the entry point. The payload is expected to configure the Gate Array
 *  itself (page the ROMs out, set the mode), as bare-metal CPC code always does.
 *  It must load at &4000 or above — the cartridge shadows &0000–&3FFF — and fit
 *  alongside the stub in one 16K block. */
export function makeCpr(code: Uint8Array, meta: CprMeta): Uint8Array {
  const load = meta.loadAddr & 0xffff;
  const entry = (meta.entryAddr ?? load) & 0xffff;
  if (load < 0x4000) throw new Error('cartridge payload must load at &4000 or above');

  const lo = (n: number) => n & 0xff;
  const hi = (n: number) => (n >> 8) & 0xff;
  const stub = [
    0xf3,                                     // di
    0x21, 0, 0,                               // ld hl,PAYLOAD (patched)
    0x11, lo(load), hi(load),                 // ld de,loadAddr
    0x01, lo(code.length), hi(code.length),   // ld bc,length
    0xed, 0xb0,                               // ldir
    0xc3, lo(entry), hi(entry),               // jp entryAddr
  ];
  const payloadAt = stub.length;
  stub[2] = lo(payloadAt);
  stub[3] = hi(payloadAt);

  if (payloadAt + code.length > BLOCK) {
    throw new Error(`program is ${code.length} bytes — too big to wrap as a cartridge`);
  }
  const page = new Uint8Array(BLOCK);
  page.set(stub, 0);
  page.set(code.subarray(0, code.length), payloadAt);
  return writeCpr([page]);
}
