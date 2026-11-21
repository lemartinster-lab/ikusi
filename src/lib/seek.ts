import type { PlaybackMode } from "./types";

export interface SeekContext {
  mode: PlaybackMode;
  /** Segundo del original en el que empieza la fuente actual. */
  offset: number;
  /** Duración total del archivo original, si se conoce. */
  duration: number | null;
  /** Hasta dónde puede saltar el <video> ya (HLS en curso: lo generado hasta ahora). */
  seekableEnd: number;
}

export type SeekPlan =
  /** Saltar dentro de la fuente actual a `time` (tiempo del <video>). */
  | { kind: "local"; time: number }
  /** Pedir a ffmpeg una nueva sesión empezando en `start` (tiempo del original). */
  | { kind: "reload"; start: number };

/** Margen tolerado más allá de lo generado antes de reiniciar ffmpeg. */
const SLACK = 0.5;

/**
 * Decide cómo saltar a `target` (segundos del archivo original).
 *
 * En modo directo siempre es un salto local. En HLS, si el destino ya está
 * generado se salta localmente; si no (o está antes del inicio de la sesión),
 * se reinicia ffmpeg desde ese punto.
 */
export function planSeek(target: number, ctx: SeekContext): SeekPlan {
  const max = ctx.duration ?? Number.POSITIVE_INFINITY;
  const t = Math.min(Math.max(0, target), Math.max(0, max - 0.25));

  if (ctx.mode === "direct") return { kind: "local", time: t };

  const local = t - ctx.offset;
  if (local >= 0 && local <= ctx.seekableEnd + SLACK) return { kind: "local", time: local };
  return { kind: "reload", start: Math.floor(t) };
}
