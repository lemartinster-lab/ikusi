// Tipos que devuelve el backend en Rust (ikusi-core), en camelCase.

export type PlaybackMode = "direct" | "remux" | "transcode";

export interface VideoStream {
  index: number;
  codec: string;
  codecTag: string;
  profile: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
}

export interface AudioStream {
  index: number;
  codec: string;
  channels: number | null;
  language: string | null;
  title: string | null;
  default: boolean;
}

export interface SubtitleStream {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  default: boolean;
  textBased: boolean;
}

export interface MediaInfo {
  formatName: string;
  duration: number | null;
  video: VideoStream | null;
  audio: AudioStream[];
  subtitles: SubtitleStream[];
}

export interface PlaybackSource {
  mode: PlaybackMode;
  /** URL del servidor local: el archivo original (directo) o la lista HLS. */
  url: string;
  /** Segundo del archivo original en el que empieza esta fuente. */
  offset: number;
  audioTrack: number | null;
  info: MediaInfo;
}

export interface SubtitleFile {
  format: "srt" | "vtt";
  text: string;
}
