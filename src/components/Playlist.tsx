import type { PlaylistItem } from "../lib/playlist";
import { CloseIcon } from "./Icons";

interface Props {
  items: PlaylistItem[];
  current: number | null;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onClose: () => void;
}

export function Playlist(p: Props) {
  return (
    <aside className="panel playlist" onDoubleClick={(e) => e.stopPropagation()}>
      <header>
        <h3>Lista ({p.items.length})</h3>
        <div>
          {p.items.length > 0 && <button className="text-btn" onClick={p.onClear}>Vaciar</button>}
          <button className="icon-btn" onClick={p.onClose} title="Cerrar (L)"><CloseIcon size={16} /></button>
        </div>
      </header>
      {p.items.length === 0 && <p className="muted pad">Arrastra archivos a la ventana para añadirlos.</p>}
      <ol>
        {p.items.map((item, i) => (
          <li key={item.path} className={i === p.current ? "current" : ""} title={item.path}>
            <button className="item-name" onClick={() => p.onPlay(i)}>
              <span className="item-num">{i + 1}</span>
              {item.name}
            </button>
            <button className="icon-btn remove" onClick={() => p.onRemove(i)} title="Quitar de la lista">
              <CloseIcon size={14} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
