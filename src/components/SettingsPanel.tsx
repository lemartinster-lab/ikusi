import { useEffect, useState } from "react";
import { aiApi, type KeyStatus, type WhisperStatus } from "../lib/aiApi";
import { LANGUAGES, TRANSLATION_MODELS, type Settings } from "../lib/settings";
import { CloseIcon } from "./Icons";

interface Props {
  settings: Settings;
  busy: boolean;
  onChange: (s: Settings) => void;
  onClose: () => void;
  /** Lanza la descarga de un modelo (el avance se ve en el aviso de tareas). */
  onDownloadModel: (name: string) => Promise<void>;
}

export function SettingsPanel({ settings, busy, onChange, onClose, onDownloadModel }: Props) {
  const [key, setKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () => {
    aiApi.keyStatus().then(setKeyStatus).catch(() => {});
    aiApi.whisperStatus().then(setWhisper).catch(() => {});
  };
  useEffect(refresh, []);

  const saveKey = async () => {
    try {
      setKeyStatus(await aiApi.setKey(key));
      setKey("");
      setMessage("Clave guardada en el Llavero");
    } catch (e) {
      setMessage(String(e));
    }
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel settings" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Ajustes</h3>
          <button className="icon-btn" onClick={onClose} title="Cerrar"><CloseIcon size={16} /></button>
        </header>

        <section>
          <h4>Claude (traducción)</h4>
          {keyStatus?.configured ? (
            <p className="ok-line">
              Clave configurada ({keyStatus.source === "env" ? "variable de entorno" : "Llavero"}) ·…{keyStatus.hint}
              {keyStatus.source === "keychain" && (
                <button className="text-btn danger" onClick={async () => setKeyStatus(await aiApi.deleteKey())}>
                  Borrar
                </button>
              )}
            </p>
          ) : (
            <p className="muted">Sin clave. Se guarda en el Llavero de macOS y nunca sale de Rust.</p>
          )}
          <div className="field-row">
            <input
              type="password"
              placeholder="sk-ant-…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key && void saveKey()}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="small-btn" disabled={!key} onClick={() => void saveKey()}>Guardar</button>
          </div>
          <label className="field">
            Modelo
            <select value={settings.translationModel} onChange={(e) => set("translationModel", e.target.value)}>
              {TRANSLATION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — {m.hint}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Traducir a
            <select value={settings.targetLang} onChange={(e) => set("targetLang", e.target.value)}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
        </section>

        <section>
          <h4>Whisper (generar subtítulos en local)</h4>
          {whisper && !whisper.binary && (
            <p className="warn-line">
              No encuentro whisper-cli. Instálalo en la Terminal con <code>brew install whisper-cpp</code> y vuelve a abrir Ajustes.
            </p>
          )}
          {whisper?.binary && <p className="ok-line">whisper-cli: <code>{whisper.binary}</code></p>}
          <div className="model-list">
            {whisper?.models.map((m) => (
              <label key={m.name} className="option">
                <input
                  type="radio"
                  name="wmodel"
                  checked={settings.whisperModel === m.name}
                  onChange={() => set("whisperModel", m.name)}
                />
                <span className="model-name">{m.name}</span>
                <span className="muted">{m.description} · {m.sizeMb >= 1000 ? `${(m.sizeMb / 1000).toFixed(1)} GB` : `${m.sizeMb} MB`}</span>
                {m.downloaded ? (
                  <span className="ok-badge">descargado</span>
                ) : (
                  <button
                    className="small-btn"
                    disabled={busy}
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        await onDownloadModel(m.name);
                      } finally {
                        refresh();
                      }
                    }}
                  >
                    Descargar
                  </button>
                )}
              </label>
            ))}
          </div>
          <label className="field">
            Idioma hablado
            <select value={settings.whisperLang} onChange={(e) => set("whisperLang", e.target.value)}>
              <option value="auto">Detectar automáticamente</option>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </label>
        </section>

        {message && <p className="settings-message">{message}</p>}
      </div>
    </div>
  );
}
