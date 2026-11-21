import { fileName } from "../lib/playlist";
import { SHORTCUT_HELP } from "../lib/shortcuts";
import { GearIcon, LogoIcon, OpenIcon } from "./Icons";

interface Props {
  recents: string[];
  backendError: string | null;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onSettings: () => void;
}

export function EmptyState({ recents, backendError, onOpen, onOpenRecent, onSettings }: Props) {
  return (
    <div className="empty">
      <LogoIcon />
      <h1>Ikusi</h1>
      {backendError ? (
        <p className="error-box">{backendError}</p>
      ) : (
        <p className="muted">Arrastra un vídeo o un audio aquí, o</p>
      )}
      <div className="empty-actions">
        <button className="primary-btn" onClick={onOpen}>
          <OpenIcon size={18} /> Abrir archivos
        </button>
        <button className="icon-btn" onClick={onSettings} title="Ajustes (Cmd+,)"><GearIcon /></button>
      </div>

      {recents.length > 0 && (
        <div className="recents">
          <h4>Recientes</h4>
          <ul>
            {recents.slice(0, 8).map((p) => (
              <li key={p}>
                <button className="text-btn" onClick={() => onOpenRecent(p)} title={p}>{fileName(p)}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="help">
        <summary>Atajos de teclado</summary>
        <dl>
          {SHORTCUT_HELP.map(([k, d]) => (
            <div key={k}><dt>{k}</dt><dd>{d}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  );
}
