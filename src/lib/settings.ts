// Ajustes de la fase 2 (IA). Se guardan con tauri-plugin-store.

export const TRANSLATION_MODELS = [
  { id: "claude-haiku-5-5", name: "Haiku 5.5", hint: "Rápido y económico" },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", hint: "Más calidad, más caro" },
] as const;

export const LANGUAGES = [
  { code: "eu", name: "Euskera" },
  { code: "es", name: "Español" },
  { code: "en", name: "Inglés" },
  { code: "fr", name: "Francés" },
  { code: "ca", name: "Catalán" },
  { code: "gl", name: "Gallego" },
  { code: "de", name: "Alemán" },
  { code: "it", name: "Italiano" },
  { code: "pt", name: "Portugués" },
] as const;

export interface Settings {
  /** Idioma al que traducir por defecto. */
  targetLang: string;
  translationModel: string;
  whisperModel: string;
  /** Idioma hablado por defecto para Whisper ("auto" = detectar). */
  whisperLang: string;
}

export const DEFAULT_SETTINGS: Settings = {
  targetLang: "es",
  translationModel: "claude-haiku-5-5",
  whisperModel: "small",
  whisperLang: "eu",
};

const WHISPER_MODELS = ["base", "small", "medium", "large-v3-turbo"];
const LANG_CODES: string[] = LANGUAGES.map((l) => l.code);

/** Completa y valida ajustes guardados (pueden venir de una versión anterior o estar dañados). */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const pick = (v: unknown, allowed: string[], fallback: string) =>
    typeof v === "string" && allowed.includes(v) ? v : fallback;
  return {
    targetLang: pick(r.targetLang, LANG_CODES, DEFAULT_SETTINGS.targetLang),
    translationModel: pick(
      r.translationModel,
      TRANSLATION_MODELS.map((m) => m.id),
      DEFAULT_SETTINGS.translationModel,
    ),
    whisperModel: pick(r.whisperModel, WHISPER_MODELS, DEFAULT_SETTINGS.whisperModel),
    whisperLang: pick(r.whisperLang, [...LANG_CODES, "auto"], DEFAULT_SETTINGS.whisperLang),
  };
}

/** ISO 639-2 de Matroska ("spa", "baq") → 639-1 ("es", "eu") para los prompts. */
const TO_639_1: Record<string, string> = {
  spa: "es", eus: "eu", baq: "eu", eng: "en", fre: "fr", fra: "fr", cat: "ca", glg: "gl",
  ger: "de", deu: "de", ita: "it", por: "pt",
};

export function toIso1(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c.length === 2) return c;
  return TO_639_1[c] ?? null;
}
