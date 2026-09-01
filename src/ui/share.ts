// Share a listing by putting it, compressed, in the URL hash. No server, no
// storage: the link is the payload.
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const KEY = 'c';

export function encodeSource(source: string): string {
  return compressToEncodedURIComponent(source);
}

export function decodeSource(token: string): string | null {
  try {
    return decompressFromEncodedURIComponent(token) || null;
  } catch {
    return null;
  }
}

/** The listing carried by a location hash, or null. */
export function sourceFromHash(hash: string): string | null {
  const m = /[#&]c=([^&]+)/.exec(hash);
  return m ? decodeSource(m[1]) : null;
}

export function hashForSource(source: string): string {
  return `#${KEY}=${encodeSource(source)}`;
}
