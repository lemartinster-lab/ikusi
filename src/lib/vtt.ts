// WebVTT como lista de cues: los subtítulos se pintan en una capa propia
// (SubtitleOverlay) en lugar de con <track>, lo que permite dos idiomas a la vez,
// subirlos sobre los controles y aplicar el retardo sin tocar el vídeo.

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseTimestamp(s: string): number | null {
  const parts = s.trim().replace(",", ".").split(":");
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return null;
}

function stamp(t: number, sep: "." | ","): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

/** Parsea WebVTT o SRT. Ignora cabecera, NOTE/STYLE/REGION y ajustes de posición. Ordena por inicio. */
export function parseVtt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const first = lines[0]?.trim() ?? "";
    if (first.startsWith("NOTE") || first === "STYLE" || first === "REGION") continue;
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti === -1) continue;
    const [a, rest] = lines[ti].split("-->");
    const start = parseTimestamp(a);
    const end = parseTimestamp(rest.trim().split(/\s+/)[0] ?? "");
    const body = lines.slice(ti + 1).join("\n").trimEnd();
    if (start == null || end == null || !body.trim()) continue;
    cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function serializeVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n");
}

export function serializeSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${stripTags(c.text)}\n`)
    .join("\n");
}

/** Cues visibles en el instante `t` (cues ordenados por inicio). */
export function activeCues(cues: Cue[], t: number): Cue[] {
  // Búsqueda binaria del último cue que empieza antes de t…
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // …y hacia atrás, por si se solapan varios.
  const out: Cue[] = [];
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    if (cues[i].end > t) out.unshift(cues[i]);
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&lrm;": "", "&rlm;": "" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (m) => ENTITIES[m]);

export function stripTags(text: string): string {
  return decode(text.replace(/<[^>]*>/g, ""));
}

export interface Segment {
  text: string;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

/**
 * Convierte el texto de un cue en líneas de segmentos con formato. Solo se
 * respetan <i>, <b> y <u>; el resto de etiquetas (<c.clase>, <v Nombre>,
 * marcas de tiempo) se eliminan. Nunca se inserta HTML: es seguro de pintar.
 */
export function cueSegments(text: string): Segment[][] {
  const state = { i: 0, b: 0, u: 0 };
  return text.split("\n").map((line) => {
    const segs: Segment[] = [];
    for (const part of line.split(/(<[^>]*>)/)) {
      if (!part) continue;
      const tag = part.match(/^<(\/?)([a-z]+)[^>]*>$/i);
      if (tag) {
        const name = tag[2].toLowerCase() as "i" | "b" | "u";
        if (name in state) state[name] = Math.max(0, state[name] + (tag[1] ? -1 : 1));
        continue;
      }
      if (part.startsWith("<")) continue; // etiqueta rara o marca de tiempo
      segs.push({ text: decode(part), italic: state.i > 0, bold: state.b > 0, underline: state.u > 0 });
    }
    return segs;
  });
}
