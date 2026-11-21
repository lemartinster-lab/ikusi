// Atajos de teclado al estilo VLC. La traducción tecla → acción es una función
// pura para poder testearla sin navegador.

export type Action =
  | { type: "togglePlay" }
  | { type: "seekBy"; seconds: number }
  | { type: "volumeBy"; delta: number }
  | { type: "toggleMute" }
  | { type: "toggleFullscreen" }
  | { type: "exitFullscreen" }
  | { type: "speed"; direction: -1 | 0 | 1 }
  | { type: "next" }
  | { type: "previous" }
  | { type: "cycleSubtitles" }
  | { type: "cycleAudio" }
  | { type: "subtitleDelay"; delta: number }
  | { type: "togglePlaylist" }
  | { type: "showTime" }
  | { type: "open" }
  | { type: "abLoop" }
  | { type: "addBookmark" }
  | { type: "settings" };

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** Salto con flechas: normal 10 s, Mayús 3 s, Ctrl/Cmd 60 s. */
function seekStep(e: KeyLike): number {
  if (e.ctrlKey || e.metaKey) return 60;
  if (e.shiftKey) return 3;
  return 10;
}

export function keyToAction(e: KeyLike): Action | null {
  const mod = e.metaKey || e.ctrlKey;
  // Cmd+O / Ctrl+O: abrir, como en cualquier app de Mac.
  if (mod && e.key.toLowerCase() === "o") return { type: "open" };
  // Cmd+, : Ajustes, como en cualquier app de Mac.
  if (mod && e.key === ",") return { type: "settings" };

  switch (e.key) {
    case " ":
    case "Spacebar":
      return { type: "togglePlay" };
    case "ArrowRight":
      return { type: "seekBy", seconds: seekStep(e) };
    case "ArrowLeft":
      return { type: "seekBy", seconds: -seekStep(e) };
    case "ArrowUp":
      return { type: "volumeBy", delta: 0.05 };
    case "ArrowDown":
      return { type: "volumeBy", delta: -0.05 };
    case "Escape":
      return { type: "exitFullscreen" };
    case "[":
      return { type: "speed", direction: -1 };
    case "]":
      return { type: "speed", direction: 1 };
    case "=":
      return { type: "speed", direction: 0 };
  }

  if (mod) return null; // no interceptar otros atajos del sistema
  switch (e.key.toLowerCase()) {
    case "f":
      return { type: "toggleFullscreen" };
    case "m":
      return { type: "toggleMute" };
    case "n":
      return { type: "next" };
    case "p":
      return { type: "previous" };
    case "v":
      return { type: "cycleSubtitles" };
    case "b":
      return { type: "cycleAudio" };
    case "g":
      return { type: "subtitleDelay", delta: -0.1 };
    case "h":
      return { type: "subtitleDelay", delta: 0.1 };
    case "l":
      return { type: "togglePlaylist" };
    case "t":
      return { type: "showTime" };
    case "r":
      return { type: "abLoop" };
    case "k":
      return { type: "addBookmark" };
    default:
      return null;
  }
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3] as const;

/** Siguiente velocidad de la escala; dirección 0 vuelve a 1×. */
export function nextSpeed(current: number, direction: -1 | 0 | 1): number {
  if (direction === 0) return 1;
  if (direction === 1) return SPEEDS.find((s) => s > current + 1e-9) ?? SPEEDS[SPEEDS.length - 1];
  return [...SPEEDS].reverse().find((s) => s < current - 1e-9) ?? SPEEDS[0];
}

/** Lista de atajos para la ayuda en pantalla. */
export const SHORTCUT_HELP: [string, string][] = [
  ["Espacio", "Reproducir / pausa"],
  ["← →", "±10 s (Mayús ±3 s, Cmd ±60 s)"],
  ["↑ ↓", "Volumen"],
  ["F / Esc", "Pantalla completa / salir"],
  ["M", "Silenciar"],
  ["[ ] =", "Velocidad − / + / normal"],
  ["N / P", "Siguiente / anterior"],
  ["V / B", "Cambiar subtítulos / audio"],
  ["G / H", "Retardo de subtítulos −/+ 0,1 s"],
  ["T", "Mostrar tiempo"],
  ["R", "Repetición A‑B (marcar A, marcar B, quitar)"],
  ["K", "Añadir marcador"],
  ["L", "Lista y marcadores"],
  ["Cmd+O", "Abrir archivos"],
  ["Cmd+,", "Ajustes (clave de Claude, Whisper)"],
];
