import type { AudioStream, SubtitleStream } from "./types";

// Códigos ISO 639-2 (los que usa Matroska) y 639-1 más habituales.
const LANGUAGES: Record<string, string> = {
  spa: "Español", es: "Español",
  eng: "Inglés", en: "Inglés",
  eus: "Euskera", baq: "Euskera", eu: "Euskera",
  cat: "Catalán", ca: "Catalán",
  glg: "Gallego", gl: "Gallego",
  fre: "Francés", fra: "Francés", fr: "Francés",
  ger: "Alemán", deu: "Alemán", de: "Alemán",
  ita: "Italiano", it: "Italiano",
  por: "Portugués", pt: "Portugués",
  jpn: "Japonés", ja: "Japonés",
  chi: "Chino", zho: "Chino", zh: "Chino",
  kor: "Coreano", ko: "Coreano",
  rus: "Ruso", ru: "Ruso",
  ara: "Árabe", ar: "Árabe",
  dut: "Neerlandés", nld: "Neerlandés", nl: "Neerlandés",
};

export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGES[code.toLowerCase()] ?? code.toUpperCase();
}

function channelsLabel(ch: number | null): string {
  if (ch == null) return "";
  if (ch === 1) return "mono";
  if (ch === 2) return "estéreo";
  if (ch === 6) return "5.1";
  if (ch === 8) return "7.1";
  return `${ch} canales`;
}

const CODEC_NAMES: Record<string, string> = {
  aac: "AAC", ac3: "Dolby Digital", eac3: "Dolby Digital+", dts: "DTS", truehd: "TrueHD",
  mp3: "MP3", flac: "FLAC", opus: "Opus", vorbis: "Vorbis",
};

export function audioLabel(a: AudioStream, position: number): string {
  const name = a.title || languageName(a.language) || `Pista ${position + 1}`;
  const details = [CODEC_NAMES[a.codec] ?? a.codec.toUpperCase(), channelsLabel(a.channels)]
    .filter(Boolean)
    .join(" ");
  return `${name} · ${details}`;
}

export function subtitleLabel(s: SubtitleStream, position: number): string {
  const lang = languageName(s.language);
  const name = [lang, s.title].filter(Boolean).join(" — ") || `Subtítulos ${position + 1}`;
  return s.textBased ? name : `${name} (imagen, no disponible)`;
}
