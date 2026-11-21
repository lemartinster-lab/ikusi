import { useRef, useState } from "react";
import type { AbState } from "../lib/abLoop";
import { formatTime } from "../lib/formatTime";
import type { PlaybackMode } from "../lib/types";
import {
  FullscreenIcon, GearIcon, ListIcon, NextIcon, OpenIcon, PauseIcon, PlayIcon, PrevIcon, TracksIcon, VolumeIcon,
} from "./Icons";

interface Props {
  visible: boolean;
  paused: boolean;
  time: number;
  duration: number | null;
  /** Hasta dónde hay contenido disponible (tiempo del original), para pintar la barra. */
  availableEnd: number;
  volume: number;
  muted: boolean;
  rate: number;
  mode: PlaybackMode | null;
  fullscreen: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  /** Tiempos de los marcadores, para pintarlos en la barra. */
  markers: number[];
  ab: AbState;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleFullscreen: () => void;
  onTogglePlaylist: () => void;
  onToggleTracks: () => void;
  onOpen: () => void;
  onSettings: () => void;
}

const MODE_LABEL: Record<PlaybackMode, [string, string]> = {
  direct: ["Directo", "El archivo se reproduce tal cual"],
  remux: ["Remux", "ffmpeg cambia el contenedor sin recodificar el vídeo"],
  transcode: ["Convirtiendo", "ffmpeg está recodificando el vídeo en tiempo real"],
};

export function Controls(p: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const dur = p.duration ?? 0;

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return { x: ratio * r.width, t: ratio * dur };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!dur) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    p.onSeek(timeAt(e.clientX).t);
  };

  const played = dur ? (p.time / dur) * 100 : 0;
  const available = dur ? (Math.min(p.availableEnd, dur) / dur) * 100 : 0;
  const pct = (t: number) => `${dur ? (t / dur) * 100 : 0}%`;

  return (
    <div className={`controls ${p.visible ? "" : "hidden"}`} onDoubleClick={(e) => e.stopPropagation()}>
      <div
        ref={barRef}
        className="seekbar"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (!dur) return;
          setHover(timeAt(e.clientX));
          if (e.buttons === 1) p.onSeek(timeAt(e.clientX).t);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="seek-track">
          <div className="seek-available" style={{ width: `${available}%` }} />
          <div className="seek-played" style={{ width: `${played}%` }} />
          {p.ab.a != null && (
            <div
              className={`seek-ab ${p.ab.b == null ? "pending" : ""}`}
              style={{ left: pct(p.ab.a), width: p.ab.b != null ? `calc(${pct(p.ab.b)} - ${pct(p.ab.a)})` : "2px" }}
              title="Repetición A‑B (R)"
            />
          )}
          {p.markers.map((t, i) => (
            <div key={i} className="seek-marker" style={{ left: pct(t) }} />
          ))}
          <div className="seek-thumb" style={{ left: `${played}%` }} />
        </div>
        {hover && <div className="seek-tooltip" style={{ left: hover.x }}>{formatTime(hover.t)}</div>}
      </div>

      <div className="controls-row">
        <button className="icon-btn" onClick={p.onPrev} disabled={!p.hasPrev} title="Anterior (P)"><PrevIcon /></button>
        <button className="icon-btn play" onClick={p.onTogglePlay} title="Reproducir / pausa (espacio)">
          {p.paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
        </button>
        <button className="icon-btn" onClick={p.onNext} disabled={!p.hasNext} title="Siguiente (N)"><NextIcon /></button>

        <span className="time">
          {formatTime(p.time)} <span className="muted">/ {formatTime(p.duration)}</span>
        </span>

        <div className="spacer" />

        {p.mode && (
          <span className={`mode-badge mode-${p.mode}`} title={MODE_LABEL[p.mode][1]}>{MODE_LABEL[p.mode][0]}</span>
        )}
        {p.rate !== 1 && <span className="rate-badge">{p.rate}×</span>}
        {p.ab.a != null && <span className="rate-badge ab-badge">{p.ab.b == null ? "A…" : "A‑B"}</span>}

        <div className="volume">
          <button className="icon-btn" onClick={p.onToggleMute} title="Silenciar (M)">
            <VolumeIcon muted={p.muted || p.volume === 0} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.muted ? 0 : p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))}
            aria-label="Volumen"
          />
        </div>

        <button className="icon-btn" onClick={p.onToggleTracks} title="Audio y subtítulos (V / B)"><TracksIcon /></button>
        <button className="icon-btn" onClick={p.onTogglePlaylist} title="Lista y marcadores (L)"><ListIcon /></button>
        <button className="icon-btn" onClick={p.onOpen} title="Abrir (Cmd+O)"><OpenIcon /></button>
        <button className="icon-btn" onClick={p.onSettings} title="Ajustes (Cmd+,)"><GearIcon /></button>
        <button className="icon-btn" onClick={p.onToggleFullscreen} title="Pantalla completa (F)">
          <FullscreenIcon exit={p.fullscreen} />
        </button>
      </div>
    </div>
  );
}
