// Conversión de subtítulos SubRip (.srt) a WebVTT, el único formato que entiende
// el elemento <track> del navegador.

const SRT_TIMING =
  /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})(.*)$/;

function pad(n: string, len: number): string {
  return n.padStart(len, "0");
}

function stamp(h: string, m: string, s: string, ms: string): string {
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${ms.padEnd(3, "0")}`;
}

export function srtToVtt(srt: string): string {
  const text = srt.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  const blocks = text.split(/\n{2,}/);
  const out: string[] = ["WEBVTT", ""];

  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIdx = lines.findIndex((l) => SRT_TIMING.test(l.trim()));
    if (timingIdx === -1) continue; // bloque corrupto: se descarta
    const m = lines[timingIdx].trim().match(SRT_TIMING)!;
    const cueLines = lines
      .slice(timingIdx + 1)
      // "-->" dentro del texto rompería el WebVTT
      .map((l) => l.replace(/-->/g, "→"))
      // etiquetas de posición de SubStation ({\an8}) que algunos SRT arrastran
      .map((l) => l.replace(/\{\\[^}]*\}/g, ""));
    if (cueLines.every((l) => l.trim() === "")) continue;

    // Los ajustes de posición de SRT ("X1:...") no son válidos en WebVTT; se descartan.
    out.push(`${stamp(m[1], m[2], m[3], m[4])} --> ${stamp(m[5], m[6], m[7], m[8])}`);
    out.push(...cueLines, "");
  }
  return out.join("\n");
}
