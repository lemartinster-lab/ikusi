// Envoltorio tipado de los comandos de Rust (src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import type { MediaInfo, PlaybackSource, SubtitleFile } from "./types";

export interface OpenOptions {
  audioTrack?: number | null;
  start?: number;
  forceTranscode?: boolean;
}

export const api = {
  openMedia: (path: string, o: OpenOptions = {}) =>
    invoke<PlaybackSource>("open_media", {
      path,
      audioTrack: o.audioTrack ?? null,
      start: o.start ?? 0,
      forceTranscode: o.forceTranscode ?? false,
    }),
  probeMedia: (path: string) => invoke<MediaInfo>("probe_media", { path }),
  stopPlayback: () => invoke<void>("stop_playback"),
  extractSubtitle: (path: string, streamIndex: number) =>
    invoke<string>("extract_subtitle", { path, streamIndex }),
  loadSubtitleFile: (path: string) => invoke<SubtitleFile>("load_subtitle_file", { path }),
  takePendingFiles: () => invoke<string[]>("take_pending_files"),
  backendStatus: () => invoke<string | null>("backend_status"),
};
