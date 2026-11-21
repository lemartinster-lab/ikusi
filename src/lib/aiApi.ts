// Comandos de IA del backend (src-tauri/src/ai.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface KeyStatus {
  configured: boolean;
  source: "keychain" | "env" | null;
  hint: string | null;
}

export interface WhisperModelInfo {
  name: string;
  sizeMb: number;
  description: string;
  downloaded: boolean;
}

export interface WhisperStatus {
  binary: string | null;
  models: WhisperModelInfo[];
}

export interface AiProgress {
  task: "translate" | "transcribe" | "download";
  stage: "translating" | "extractingAudio" | "transcribing" | "downloading";
  percent: number;
}

export const aiApi = {
  keyStatus: () => invoke<KeyStatus>("api_key_status"),
  setKey: (key: string) => invoke<KeyStatus>("set_api_key", { key }),
  deleteKey: () => invoke<KeyStatus>("delete_api_key"),
  translate: (args: { vtt: string; sourceLang: string | null; targetLang: string; model: string; title: string | null }) =>
    invoke<string>("translate_subtitles", args),
  whisperStatus: () => invoke<WhisperStatus>("whisper_status"),
  downloadModel: (name: string) => invoke<void>("download_whisper_model", { name }),
  transcribe: (args: { path: string; audioTrack: number | null; language: string; model: string }) =>
    invoke<string>("transcribe_media", args),
  cancel: () => invoke<void>("cancel_ai_task"),
  saveTextFile: (path: string, contents: string) => invoke<void>("save_text_file", { path, contents }),
};

export function onAiProgress(cb: (p: AiProgress) => void) {
  return listen<AiProgress>("ikusi://ai-progress", (e) => cb(e.payload));
}

export const STAGE_LABEL: Record<AiProgress["stage"], string> = {
  translating: "Traduciendo con Claude",
  extractingAudio: "Extrayendo el audio",
  transcribing: "Transcribiendo con Whisper",
  downloading: "Descargando modelo de Whisper",
};
