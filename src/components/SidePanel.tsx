import type { Bookmark } from "../lib/bookmarks";
import { formatTime } from "../lib/formatTime";
import type { PlaylistItem } from "../lib/playlist";
import { stripTags } from "../lib/vtt";
import { CloseIcon } from "./Icons";

export type SideTab = "playlist" | "bookmarks";

interface Props {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  onClose: () => void;
  // Lista
  items: PlaylistItem[];
  current: number | null;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  // Marcadores
  bookmarks: Bookmark[];
  hasMedia: boolean;
  onJump: (time: number) => void;
  onNote: (id: string, note: string) => void;
  onDeleteBookmark: (id: string) => void;
  onAddBookmark: () => void;
  onExport: () => void;
  onCopy: () => void;
}

export function SidePanel(p: Props) {
  return (
    <aside className="panel side-panel" onDoubleClick={(e) => e.stopPropagation()}>
      <header>
        <div className="tabs">
          <button className={p.tab === "playlist" ? "active" : ""} onClick={() => p.onTab("playlist")}>
            Lista ({p.items.length})
          </button>
          <button className={p.tab === "bookmarks" ? "active" : ""} onClick={() => p.onTab("bookmarks")}>
            Marcadores ({p.bookmarks.length})
          </button>
        </div>
        <button className="icon-btn" onClick={p.onClose} title="Cerrar (L)"><CloseIcon size={16} /></button>
      </header>

      {p.tab === "playlist" ? (
        <>
          {p.items.length === 0 && <p className="muted pad">Arrastra archivos a la ventana para añadirlos.</p>}
          <ol className="side-list">
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
          {p.items.length > 0 && (
            <footer><button className="text-btn" onClick={p.onClear}>Vaciar lista</button></footer>
          )}
        </>
      ) : (
        <>
          {!p.hasMedia && <p className="muted pad">Abre un vídeo para añadir marcadores.</p>}
          {p.hasMedia && p.bookmarks.length === 0 && (
            <p className="muted pad">Pulsa K durante la reproducción para marcar un momento. Se guarda también el subtítulo que se ve.</p>
          )}
          <ol className="side-list bookmarks">
            {p.bookmarks.map((b) => (
              <li key={b.id}>
                <div className="bm-head">
                  <button className="bm-time" onClick={() => p.onJump(b.time)} title="Ir a este momento">
                    {formatTime(b.time)}
                  </button>
                  <input
                    className="bm-note"
                    placeholder="Nota…"
                    defaultValue={b.note}
                    onBlur={(e) => e.target.value !== b.note && p.onNote(b.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button className="icon-btn remove" onClick={() => p.onDeleteBookmark(b.id)} title="Borrar marcador">
                    <CloseIcon size={14} />
                  </button>
                </div>
                {b.quote && <p className="bm-quote">{stripTags(b.quote)}</p>}
                {b.quote2 && <p className="bm-quote second">{stripTags(b.quote2)}</p>}
              </li>
            ))}
          </ol>
          {p.hasMedia && (
            <footer>
              <button className="small-btn" onClick={p.onAddBookmark}>+ Marcar ahora (K)</button>
              {p.bookmarks.length > 0 && (
                <>
                  <button className="text-btn" onClick={p.onExport}>Exportar .md</button>
                  <button className="text-btn" onClick={p.onCopy}>Copiar</button>
                </>
              )}
            </footer>
          )}
        </>
      )}
    </aside>
  );
}
