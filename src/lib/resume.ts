// «Seguir viendo»: lógica pura y un almacén abstracto (en la app es
// tauri-plugin-store; en los tests, memoria).

export interface ResumeEntry {
  position: number;
  duration: number | null;
  updatedAt: number;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const MIN_POSITION = 10; // no merece la pena reanudar los primeros segundos
const END_MARGIN = 15; // ni cuando ya iban por los créditos finales
const MIN_DURATION = 60; // ni en archivos cortos

export function shouldResume(position: number, duration: number | null): boolean {
  if (!Number.isFinite(position) || position < MIN_POSITION) return false;
  if (duration == null) return true;
  if (duration < MIN_DURATION) return false;
  return position < duration - END_MARGIN;
}

const key = (path: string) => `resume:${path}`;

export async function loadResume(store: KeyValueStore, path: string): Promise<number | null> {
  const e = await store.get<ResumeEntry>(key(path));
  return e && shouldResume(e.position, e.duration) ? e.position : null;
}

export async function saveResume(
  store: KeyValueStore,
  path: string,
  position: number,
  duration: number | null,
  now: number = Date.now(),
): Promise<void> {
  if (shouldResume(position, duration)) {
    await store.set(key(path), { position, duration, updatedAt: now } satisfies ResumeEntry);
  } else {
    // Al principio o al final: no hay nada que reanudar.
    await store.delete(key(path));
  }
}

export const RECENTS_KEY = "recents";
export const MAX_RECENTS = 15;

export function pushRecent(recents: string[], path: string): string[] {
  return [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
}

export function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) {
      return data.get(k) as T | undefined;
    },
    async set(k, v) {
      data.set(k, v);
    },
    async delete(k) {
      data.delete(k);
    },
  };
}
