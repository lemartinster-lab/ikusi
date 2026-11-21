// Marcadores con notas por archivo (tecla K), exportables a Markdown para
// llevarlos a Obsidian u otras notas.

import { formatTime } from "./formatTime";
import { stripTags } from "./vtt";

export interface Bookmark {
  id: string;
  /** Segundos del archivo original. */
  time: number;
  note: string;
  /** Subtítulos visibles en ese momento (principal y segunda línea). */
  quote?: string;
  quote2?: string;
}

export const bookmarksKey = (path: string) => `bookmarks:${path}`;

export function newBookmark(time: number, quote?: string, quote2?: string, id: string = crypto.randomUUID()): Bookmark {
  return { id, time, note: "", quote: quote || undefined, quote2: quote2 || undefined };
}

export function addBookmark(list: Bookmark[], b: Bookmark): Bookmark[] {
  return [...list, b].sort((x, y) => x.time - y.time);
}

export function updateNote(list: Bookmark[], id: string, note: string): Bookmark[] {
  return list.map((b) => (b.id === id ? { ...b, note } : b));
}

export function removeBookmark(list: Bookmark[], id: string): Bookmark[] {
  return list.filter((b) => b.id !== id);
}

function quoteLines(text: string, italic: boolean): string[] {
  return stripTags(text)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `  > ${italic ? `*${l.trim()}*` : l.trim()}`);
}

export function bookmarksToMarkdown(opts: {
  title: string;
  path: string;
  bookmarks: Bookmark[];
  date?: Date;
}): string {
  const date = (opts.date ?? new Date()).toLocaleDateString("es-ES");
  const out = [`# ${opts.title}`, "", `> Marcadores de Ikusi · \`${opts.path}\` · ${date}`, ""];
  for (const b of opts.bookmarks) {
    const note = b.note.trim();
    out.push(`- **${formatTime(b.time)}**${note ? ` — ${note}` : ""}`);
    if (b.quote) out.push(...quoteLines(b.quote, false));
    if (b.quote2) out.push(...quoteLines(b.quote2, true));
  }
  return out.join("\n") + "\n";
}
