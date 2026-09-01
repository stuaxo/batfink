// Named listings saved in localStorage, so a session survives a reload without
// needing an account.
const KEY = 'batfink:revisions';

export interface Revision {
  name: string;
  source: string;
  saved: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(s: Store): Record<string, Revision> {
  try {
    const raw = s.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Revision>) : {};
  } catch {
    return {};
  }
}

/** Most recently saved first. */
export function listRevisions(s = store()): Revision[] {
  if (!s) return [];
  return Object.values(readAll(s)).sort((a, b) => b.saved - a.saved);
}

export function getRevision(name: string, s = store()): Revision | null {
  return s ? readAll(s)[name] ?? null : null;
}

export function saveRevision(name: string, source: string, s = store()): void {
  if (!s) return;
  const all = readAll(s);
  all[name] = { name, source, saved: Date.now() };
  s.setItem(KEY, JSON.stringify(all));
}

export function deleteRevision(name: string, s = store()): void {
  if (!s) return;
  const all = readAll(s);
  delete all[name];
  s.setItem(KEY, JSON.stringify(all));
}
