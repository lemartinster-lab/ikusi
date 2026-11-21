import type { SubtitleOption } from "../hooks/useSubtitles";
import { formatDelay } from "../lib/formatTime";
import { LANGUAGES } from "../lib/settings";
import { SPEEDS } from "../lib/shortcuts";
import { audioLabel } from "../lib/tracks";
import type { AudioStream } from "../lib/types";
import { CloseIcon } from "./Icons";

interface Props {
  audio: AudioStream[];
  audioTrack: number | null;
  subtitles: SubtitleOption[];
  primaryId: string | null;
  secondaryId: string | null;
  subtitleDelay: number;
  rate: number;
  // IA
  aiBusy: boolean;
  targetLang: string;
  whisperLang: string;
  onAudio: (track: number) => void;
  onPrimary: (id: string | null) => void;
  onSecondary: (id: string | null) => void;
  onLoadSubtitleFile: () => void;
  onSaveSubtitles: () => void;
  onDelay: (delta: number | null) => void;
  onRate: (r: number) => void;
  onTargetLang: (code: string) => void;
  onWhisperLang: (code: string) => void;
  onTranslate: () => void;
  onTranscribe: () => void;
  onClose: () => void;
}

export function TrackMenu(p: Props) {
  const usable = p.subtitles.filter((s) => !s.disabled);
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
          <input type="radio" name="subs" checked={p.primaryId === null} onChange={() => p.onPrimary(null)} />
          Desactivados
        </label>
        {p.subtitles.map((s) => (
          <label key={s.id} className={`option ${s.disabled ? "disabled" : ""}`}>
            <input
              type="radio"
              name="subs"
              disabled={s.disabled}
              checked={p.primaryId === s.id}
              onChange={() => p.onPrimary(s.id)}
            />
            {s.label}
          </label>
        ))}
        <label className="field">
          Segunda línea (modo estudio)
          <select value={p.secondaryId ?? ""} onChange={(e) => p.onSecondary(e.target.value || null)}>
            <option value="">Ninguna</option>
            {usable.filter((s) => s.id !== p.primaryId).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="link-row">
          <button className="text-btn" onClick={p.onLoadSubtitleFile}>Cargar archivo…</button>
          {p.primaryId && <button className="text-btn" onClick={p.onSaveSubtitles}>Guardar como .srt/.vtt…</button>}
        </div>
        <div className="delay-row">
          <span>Retardo</span>
          <button className="small-btn" onClick={() => p.onDelay(-0.1)} title="G">−0,1</button>
          <span className="delay-value">{formatDelay(p.subtitleDelay)}</span>
          <button className="small-btn" onClick={() => p.onDelay(0.1)} title="H">+0,1</button>
          <button className="small-btn" onClick={() => p.onDelay(null)}>0</button>
        </div>
      </section>

      <section>
        <h4>Inteligencia artificial</h4>
        <div className="ai-row">
          <button className="small-btn" disabled={p.aiBusy || !p.primaryId} onClick={p.onTranslate}
            title={p.primaryId ? "Traduce los subtítulos activos con Claude y los pone como segunda línea" : "Activa antes unos subtítulos"}>
            Traducir subtítulos a
          </button>
          <select value={p.targetLang} onChange={(e) => p.onTargetLang(e.target.value)} disabled={p.aiBusy}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div className="ai-row">
          <button className="small-btn" disabled={p.aiBusy || p.audio.length === 0} onClick={p.onTranscribe}
            title="Genera subtítulos de la pista de audio actual con Whisper, en tu Mac">
            Generar con Whisper, idioma
          </button>
          <select value={p.whisperLang} onChange={(e) => p.onWhisperLang(e.target.value)} disabled={p.aiBusy}>
            <option value="auto">Detectar</option>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
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
