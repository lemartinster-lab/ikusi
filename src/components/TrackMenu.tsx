import { formatDelay } from "../lib/formatTime";
import { SPEEDS } from "../lib/shortcuts";
import { audioLabel } from "../lib/tracks";
import type { AudioStream } from "../lib/types";
import { CloseIcon } from "./Icons";

export interface SubtitleOption {
  id: string;
  label: string;
  /** Pista incrustada (índice de stream) o archivo externo ya cargado. */
  source: { kind: "embedded"; streamIndex: number } | { kind: "external"; vtt: string };
  disabled?: boolean;
}

interface Props {
  audio: AudioStream[];
  audioTrack: number | null;
  subtitles: SubtitleOption[];
  activeSubtitle: string | null;
  subtitleDelay: number;
  rate: number;
  onAudio: (track: number) => void;
  onSubtitle: (id: string | null) => void;
  onLoadSubtitleFile: () => void;
  onDelay: (delta: number | null) => void;
  onRate: (r: number) => void;
  onClose: () => void;
}

export function TrackMenu(p: Props) {
  return (
    <div className="panel track-menu" onDoubleClick={(e) => e.stopPropagation()}>
      <header>
        <h3>Pistas</h3>
        <button className="icon-btn" onClick={p.onClose} title="Cerrar"><CloseIcon size={16} /></button>
      </header>

      <section>
        <h4>Audio</h4>
        {p.audio.length === 0 && <p className="muted">Sin audio</p>}
        {p.audio.map((a, i) => (
          <label key={a.index} className="option">
            <input type="radio" name="audio" checked={p.audioTrack === i} onChange={() => p.onAudio(i)} />
            {audioLabel(a, i)}
          </label>
        ))}
      </section>

      <section>
        <h4>Subtítulos</h4>
        <label className="option">
          <input type="radio" name="subs" checked={p.activeSubtitle === null} onChange={() => p.onSubtitle(null)} />
          Desactivados
        </label>
        {p.subtitles.map((s) => (
          <label key={s.id} className={`option ${s.disabled ? "disabled" : ""}`}>
            <input
              type="radio"
              name="subs"
              disabled={s.disabled}
              checked={p.activeSubtitle === s.id}
              onChange={() => p.onSubtitle(s.id)}
            />
            {s.label}
          </label>
        ))}
        <button className="text-btn" onClick={p.onLoadSubtitleFile}>Cargar archivo de subtítulos…</button>
        <div className="delay-row">
          <span>Retardo</span>
          <button className="small-btn" onClick={() => p.onDelay(-0.1)} title="G">−0,1</button>
          <span className="delay-value">{formatDelay(p.subtitleDelay)}</span>
          <button className="small-btn" onClick={() => p.onDelay(0.1)} title="H">+0,1</button>
          <button className="small-btn" onClick={() => p.onDelay(null)}>0</button>
        </div>
      </section>

      <section>
        <h4>Velocidad</h4>
        <div className="speed-row">
          {SPEEDS.map((s) => (
            <button key={s} className={`small-btn ${p.rate === s ? "active" : ""}`} onClick={() => p.onRate(s)}>
              {s}×
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
