// Persistencia en disco con tauri-plugin-store (archivo ikusi.json en la
// carpeta de datos de la app).

import { LazyStore } from "@tauri-apps/plugin-store";
import { pushRecent, RECENTS_KEY, type KeyValueStore } from "./resume";
import { normalizeSettings, type Settings } from "./settings";

const store = new LazyStore("ikusi.json", { defaults: {}, autoSave: 500 });

export const kv: KeyValueStore = {
  get: <T,>(k: string) => store.get<T>(k),
  set: (k, v) => store.set(k, v),
  delete: async (k) => {
    await store.delete(k);
  },
};

export async function getRecents(): Promise<string[]> {
  return (await store.get<string[]>(RECENTS_KEY)) ?? [];
}

export async function addRecent(path: string): Promise<string[]> {
  const next = pushRecent(await getRecents(), path);
  await store.set(RECENTS_KEY, next);
  return next;
}

export async function getVolume(): Promise<number> {
  const v = await store.get<number>("volume");
  return typeof v === "number" && v >= 0 && v <= 1 ? v : 1;
}

export async function setVolume(v: number): Promise<void> {
  await store.set("volume", v);
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await store.get("settings"));
}

export async function saveSettings(s: Settings): Promise<void> {
  await store.set("settings", s);
}
