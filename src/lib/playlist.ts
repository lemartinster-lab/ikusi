export const VIDEO_EXTENSIONS = [
  "mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "mts", "wmv", "flv", "mpg", "mpeg", "3gp", "ogv",
];
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "flac", "wav", "aac", "ogg", "opus", "wma"];
export const SUBTITLE_EXTENSIONS = ["srt", "vtt", "ass", "ssa"];

export interface PlaylistItem {
  path: string;
  name: string;
}

export function extensionOf(path: string): string {
  const base = fileName(path);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isMediaPath(path: string): boolean {
  const ext = extensionOf(path);
  return VIDEO_EXTENSIONS.includes(ext) || AUDIO_EXTENSIONS.includes(ext);
}

export function isSubtitlePath(path: string): boolean {
  return SUBTITLE_EXTENSIONS.includes(extensionOf(path));
}

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Convierte rutas en elementos de lista: descarta lo que no es multimedia y
 * ordena de forma "natural" (Capítulo 2 antes que Capítulo 10).
 */
export function toPlaylist(paths: string[]): PlaylistItem[] {
  return paths
    .filter(isMediaPath)
    .map((path) => ({ path, name: fileName(path) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/** Añade sin duplicar (por ruta) conservando el orden existente. */
export function mergePlaylist(current: PlaylistItem[], added: PlaylistItem[]): PlaylistItem[] {
  const seen = new Set(current.map((i) => i.path));
  return [...current, ...added.filter((i) => !seen.has(i.path))];
}

/** Índice siguiente/anterior, o null si se sale de la lista. */
export function stepIndex(index: number, length: number, direction: 1 | -1): number | null {
  const next = index + direction;
  return next >= 0 && next < length ? next : null;
}
