import { describe, it, expect, vi } from 'vitest';
import { encodeSource, decodeSource, sourceFromHash, hashForSource } from '../../src/ui/share';
import { listRevisions, saveRevision, getRevision, deleteRevision, type Revision } from '../../src/ui/revisions';

describe('share links', () => {
  const src = '  org &4000\nstart:\n  ld a,&41\n  ret\n';

  it('round-trips a listing through the compressed token', () => {
    expect(decodeSource(encodeSource(src))).toBe(src);
  });

  it('is URL-safe', () => {
    expect(encodeSource(src)).toMatch(/^[A-Za-z0-9+\-$_.]*$/);
  });

  it('reads a listing back out of a hash', () => {
    expect(sourceFromHash(hashForSource(src))).toBe(src);
    expect(sourceFromHash('#nothing-here')).toBeNull();
    expect(sourceFromHash('')).toBeNull();
  });

  it('returns null for a corrupt token', () => {
    expect(decodeSource('!!!not-valid!!!')).toBeNull();
  });
});

describe('revisions', () => {
  function fakeStore() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it('saves, lists newest first, reads and deletes', () => {
    const s = fakeStore();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    saveRevision('one', 'a', s);
    now.mockReturnValue(2000);
    saveRevision('two', 'b', s);
    now.mockRestore();
    const names = listRevisions(s).map((r: Revision) => r.name);
    expect(names).toEqual(['two', 'one']);
    expect(getRevision('one', s)?.source).toBe('a');
    deleteRevision('one', s);
    expect(getRevision('one', s)).toBeNull();
    expect(listRevisions(s)).toHaveLength(1);
  });

  it('is a no-op when storage is unavailable', () => {
    expect(() => saveRevision('x', 'y', null as never)).not.toThrow();
    expect(listRevisions(null as never)).toEqual([]);
  });
});
