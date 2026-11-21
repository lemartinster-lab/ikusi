import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { Controls } from "./components/Controls";
import { EmptyState } from "./components/EmptyState";
import { Playlist } from "./components/Playlist";
import { TrackMenu, type SubtitleOption } from "./components/TrackMenu";
import { useAutoHide } from "./hooks/useAutoHide";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useOsd } from "./hooks/useOsd";
import { useSubtitleTrack } from "./hooks/useSubtitleTrack";
import { formatDelay, formatTime } from "./lib/formatTime";
import { api, type OpenOptions } from "./lib/playbackApi";
import { addRecent, getRecents, getVolume, kv, setVolume as persistVolume } from "./lib/persist";
import {
  AUDIO_EXTENSIONS, fileName, isSubtitlePath, mergePlaylist, stepIndex, SUBTITLE_EXTENSIONS, toPlaylist,
  VIDEO_EXTENSIONS, type PlaylistItem,
} from "./lib/playlist";
import { loadResume, saveResume } from "./lib/resume";
import { planSeek } from "./lib/seek";
import { nextSpeed, type Action } from "./lib/shortcuts";
import { srtToVtt } from "./lib/srtToVtt";
import { audioLabel, subtitleLabel } from "./lib/tracks";
import type { MediaInfo, PlaybackSource } from "./lib/types";

type Source = PlaybackSource & { path: string; forced: boolean };

const SAVE_EVERY_MS = 5000;

function embeddedSubtitleOptions(info: MediaInfo): SubtitleOption[] {
  return info.subtitles.map((s, i) => ({
    id: `emb:${s.index}`,
    label: subtitleLabel(s, i),
    source: { kind: "embedded", streamIndex: s.index },
    disabled: !s.textBased,
  }));
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  // --- Lista y fuente actual ---
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [recents, setRecents] = useState<string[]>([]);

  // --- Estado de reproducción ---
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [availableEnd, setAvailableEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showTracks, setShowTracks] = useState(false);
  const [dragging, setDragging] = useState(false);

  // --- Subtítulos ---
  const [subOptions, setSubOptions] = useState<SubtitleOption[]>([]);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [activeVtt, setActiveVtt] = useState<string | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const vttCache = useRef(new Map<string, string>());

  const osd = useOsd();
  const { visible: controlsVisible, poke } = useAutoHide(!paused && !showTracks && !loading);

  // Refs con los valores más recientes, para callbacks asíncronos y eventos.
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const timeRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const loadSeq = useRef(0);
  const pendingSeek = useRef<number | null>(null);
  const autoplay = useRef(true);
  const lastSave = useRef(0);
  const reloadTimer = useRef<number | undefined>(undefined);

  const current = index != null ? items[index] ?? null : null;
  const duration = source?.info.duration ?? null;

  useSubtitleTrack(
    videoEl,
    activeVtt,
    subDelay - (source?.offset ?? 0),
    source ? `${source.url}|${source.offset}` : "",
  );

  // ---------------------------------------------------------------- carga

  const persistPosition = useCallback(async () => {
    const s = sourceRef.current;
    if (!s) return;
    await saveResume(kv, s.path, timeRef.current, s.info.duration).catch(() => {});
  }, []);

  /** Pide al backend la fuente de `path`. Devuelve null si falla o si otra carga la ha sustituido. */
  const openSource = useCallback(async (path: string, opts: OpenOptions, play = true): Promise<Source | null> => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const src = await api.openMedia(path, opts);
      if (seq !== loadSeq.current) return null;
      const next: Source = { ...src, path, forced: !!opts.forceTranscode };
      pendingSeek.current = src.mode === "direct" && opts.start ? opts.start : null;
      autoplay.current = play;
      timeRef.current = opts.start ?? 0;
      setTime(timeRef.current);
      setAvailableEnd(timeRef.current);
      setSource(next);
      return next;
    } catch (e) {
      if (seq === loadSeq.current) {
        setLoading(false);
        setError(String(e));
      }
      return null;
    }
  }, []);

  const playPath = useCallback(
    async (path: string) => {
      await persistPosition();
      vttCache.current.clear();
      setActiveSub(null);
      setActiveVtt(null);
      setSubDelay(0);
      setSubOptions([]);
      setShowTracks(false);

      const resumeAt = await loadResume(kv, path).catch(() => null);
      addRecent(path).then(setRecents).catch(() => {});
      const src = await openSource(path, { start: resumeAt ?? 0 });
      if (!src) return;
      setSubOptions(embeddedSubtitleOptions(src.info));
      if (resumeAt) osd.show(`Reanudando en ${formatTime(resumeAt)}`, 2500);
    },
    [openSource, persistPosition, osd],
  );

  const playIndex = useCallback(
    (i: number, list: PlaylistItem[] = itemsRef.current) => {
      const item = list[i];
      if (!item) return;
      setIndex(i);
      void playPath(item.path);
    },
    [playPath],
  );

  const stopAll = useCallback(async () => {
    await persistPosition();
    loadSeq.current++;
    setSource(null);
    setIndex(null);
    setLoading(false);
    setPaused(true);
    setActiveVtt(null);
    setActiveSub(null);
    await api.stopPlayback().catch(() => {});
  }, [persistPosition]);

  const loadSubtitleFile = useCallback(
    async (path: string) => {
      if (!sourceRef.current) {
        osd.show("Abre primero un vídeo para añadirle subtítulos");
        return;
      }
      try {
        const f = await api.loadSubtitleFile(path);
        const vtt = f.format === "srt" ? srtToVtt(f.text) : f.text;
        const id = `ext:${path}`;
        setSubOptions((prev) => [
          ...prev.filter((o) => o.id !== id),
          { id, label: fileName(path), source: { kind: "external", vtt } },
        ]);
        setActiveSub(id);
        setActiveVtt(vtt);
        osd.show(`Subtítulos: ${fileName(path)}`);
      } catch (e) {
        osd.show(String(e), 3500);
      }
    },
    [osd],
  );

  /** Añade rutas (arrastradas, abiertas o desde el Finder) y reproduce la primera. */
  const addPaths = useCallback(
    async (paths: string[]) => {
      const media = toPlaylist(paths);
      if (media.length) {
        const merged = mergePlaylist(itemsRef.current, media);
        setItems(merged);
        playIndex(merged.findIndex((x) => x.path === media[0].path), merged);
      }
      for (const s of paths.filter(isSubtitlePath)) await loadSubtitleFile(s);
    },
    [playIndex, loadSubtitleFile],
  );
  const addPathsRef = useRef(addPaths);
  addPathsRef.current = addPaths;

  const openFiles = useCallback(async () => {
    const picked = await openDialog({
      multiple: true,
      title: "Abrir en Ikusi",
      filters: [
        { name: "Vídeo y audio", extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
        { name: "Subtítulos", extensions: SUBTITLE_EXTENSIONS },
      ],
    });
    if (picked) await addPaths(Array.isArray(picked) ? picked : [picked]);
  }, [addPaths]);

  const pickSubtitleFile = useCallback(async () => {
    const picked = await openDialog({
      multiple: false,
      title: "Cargar subtítulos",
      filters: [{ name: "Subtítulos", extensions: SUBTITLE_EXTENSIONS }],
    });
    if (typeof picked === "string") await loadSubtitleFile(picked);
  }, [loadSubtitleFile]);

  // ------------------------------------------------------------- acciones

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !sourceRef.current) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = useCallback(
    (target: number) => {
      const v = videoRef.current;
      const s = sourceRef.current;
      if (!v || !s) return;
      const end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
      const plan = planSeek(target, {
        mode: s.mode,
        offset: s.offset,
        duration: s.info.duration ?? (Number.isFinite(v.duration) ? v.duration : null),
        seekableEnd: end,
      });
      window.clearTimeout(reloadTimer.current);
      if (plan.kind === "local") {
        v.currentTime = plan.time;
        timeRef.current = s.offset + plan.time;
        setTime(timeRef.current);
        return;
      }
      // El destino aún no está generado: reiniciar ffmpeg desde ahí. Se espera
      // un poco para no lanzar una sesión por cada movimiento al arrastrar.
      timeRef.current = plan.start;
      setTime(plan.start);
      const wasPlaying = !v.paused;
      reloadTimer.current = window.setTimeout(() => {
        void openSource(s.path, { start: plan.start, audioTrack: s.audioTrack, forceTranscode: s.forced }, wasPlaying);
      }, 300);
    },
    [openSource],
  );

  const changeVolume = useCallback(
    (v: number) => {
      const clamped = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
      setVolume(clamped);
      setMuted(false);
      void persistVolume(clamped).catch(() => {});
      return clamped;
    },
    [],
  );

  const selectAudio = useCallback(
    (track: number) => {
      const s = sourceRef.current;
      const v = videoRef.current;
      if (!s || track === s.audioTrack) return;
      osd.show(`Audio: ${audioLabel(s.info.audio[track], track)}`);
      void openSource(s.path, { start: timeRef.current, audioTrack: track, forceTranscode: s.forced }, !(v?.paused ?? true));
    },
    [openSource, osd],
  );

  const selectSubtitle = useCallback(
    async (id: string | null) => {
      const s = sourceRef.current;
      if (id === null) {
        setActiveSub(null);
        setActiveVtt(null);
        osd.show("Subtítulos desactivados");
        return;
      }
      const opt = subOptions.find((o) => o.id === id);
      if (!s || !opt || opt.disabled) return;
      let vtt = opt.source.kind === "external" ? opt.source.vtt : vttCache.current.get(id);
      if (!vtt && opt.source.kind === "embedded") {
        osd.show("Cargando subtítulos…", 15000);
        try {
          vtt = await api.extractSubtitle(s.path, opt.source.streamIndex);
          vttCache.current.set(id, vtt);
        } catch (e) {
          osd.show(String(e), 3500);
          return;
        }
      }
      setActiveSub(id);
      setActiveVtt(vtt ?? null);
      osd.show(`Subtítulos: ${opt.label}`);
    },
    [subOptions, osd],
  );

  const toggleFullscreen = useCallback(async (force?: boolean) => {
    const w = getCurrentWindow();
    const next = force ?? !(await w.isFullscreen());
    await w.setFullscreen(next);
    setFullscreen(next);
  }, []);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (index == null) return;
      const next = stepIndex(index, items.length, direction);
      if (next != null) playIndex(next);
    },
    [index, items.length, playIndex],
  );

  const handleAction = (a: Action) => {
    const v = videoRef.current;
    switch (a.type) {
      case "open":
        void openFiles();
        return;
      case "togglePlaylist":
        setShowPlaylist((x) => !x);
        return;
      case "exitFullscreen":
        if (fullscreen) void toggleFullscreen(false);
        return;
      case "toggleFullscreen":
        void toggleFullscreen();
        return;
    }
    if (!v || !source) return;
    poke();
    switch (a.type) {
      case "togglePlay":
        togglePlay();
        break;
      case "seekBy": {
        const target = Math.min(Math.max(0, timeRef.current + a.seconds), duration ?? Infinity);
        seekTo(target);
        osd.show(`${a.seconds > 0 ? "+" : "−"}${Math.abs(a.seconds)} s  ·  ${formatTime(target)}`);
        break;
      }
      case "volumeBy": {
        const nv = changeVolume((muted ? 0 : volume) + a.delta);
        osd.show(`Volumen ${Math.round(nv * 100)} %`);
        break;
      }
      case "toggleMute":
        setMuted((m) => {
          osd.show(m ? `Volumen ${Math.round(volume * 100)} %` : "Silencio");
          return !m;
        });
        break;
      case "speed": {
        const r = nextSpeed(rate, a.direction);
        setRate(r);
        osd.show(`Velocidad ${r}×`);
        break;
      }
      case "next":
        step(1);
        break;
      case "previous":
        step(-1);
        break;
      case "cycleAudio": {
        const n = source.info.audio.length;
        if (n < 2) osd.show("Solo hay una pista de audio");
        else selectAudio(((source.audioTrack ?? 0) + 1) % n);
        break;
      }
      case "cycleSubtitles": {
        const ids = [null, ...subOptions.filter((o) => !o.disabled).map((o) => o.id)];
        if (ids.length === 1) {
          osd.show("No hay subtítulos disponibles");
          break;
        }
        const i = ids.indexOf(activeSub);
        void selectSubtitle(ids[(i + 1) % ids.length]);
        break;
      }
      case "subtitleDelay": {
        const d = Math.round((subDelay + a.delta) * 100) / 100;
        setSubDelay(d);
        osd.show(`Retardo de subtítulos ${formatDelay(d)}`);
        break;
      }
      case "showTime":
        osd.show(`${formatTime(timeRef.current)} / ${formatTime(duration)}`);
        break;
    }
  };
  useKeyboardShortcuts(handleAction);

  // ------------------------------------------------------------- efectos

  // Arranque: estado del backend, recientes, volumen y archivos del Finder.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      setBackendError(await api.backendStatus().catch(() => null));
      setRecents(await getRecents().catch(() => []));
      setVolume(await getVolume().catch(() => 1));
      const pending = await api.takePendingFiles().catch(() => []);
      if (pending.length) await addPathsRef.current(pending);
      const u = await listen("ikusi://open-files", async () => {
        const files = await api.takePendingFiles();
        if (files.length) await addPathsRef.current(files);
      });
      if (cancelled) u();
      else unlisten = u;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Arrastrar y soltar archivos sobre la ventana.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          void addPathsRef.current(p.paths);
        }
      })
      .then((u) => (cancelled ? u() : (unlisten = u)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Sincronizar el estado de pantalla completa si se cambia con el botón verde.
  useEffect(() => {
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    w.onResized(async () => setFullscreen(await w.isFullscreen())).then((u) => (cancelled ? u() : (unlisten = u)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Cargar la fuente en el <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!source) {
      v.removeAttribute("src");
      v.load();
      return;
    }
    v.src = source.url;
    v.load();
  }, [source]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    void getCurrentWindow().setTitle(current ? `${current.name} — Ikusi` : "Ikusi").catch(() => {});
  }, [current]);

  // Guardar la posición al cerrar la ventana.
  useEffect(() => {
    const onUnload = () => void persistPosition();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [persistPosition]);

  // ------------------------------------------------------ eventos del vídeo

  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    if (pendingSeek.current != null) {
      v.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    }
    v.playbackRate = rate;
    if (autoplay.current) void v.play().catch(() => {});
  };

  const onTimeUpdate = () => {
    const v = videoRef.current!;
    const s = sourceRef.current;
    if (!s) return;
    timeRef.current = s.offset + v.currentTime;
    setTime(timeRef.current);
    const end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    setAvailableEnd(s.mode === "direct" ? (s.info.duration ?? v.duration) : s.offset + end);
    const now = Date.now();
    if (now - lastSave.current > SAVE_EVERY_MS) {
      lastSave.current = now;
      void persistPosition();
    }
  };

  const onEnded = () => {
    const s = sourceRef.current;
    if (s) void saveResume(kv, s.path, s.info.duration ?? timeRef.current, s.info.duration).catch(() => {});
    if (index != null && stepIndex(index, items.length, 1) != null) step(1);
  };

  const onError = () => {
    const v = videoRef.current;
    const s = sourceRef.current;
    if (!v || !s || !v.getAttribute("src")) return;
    // Recurso automático: si WebKit no puede con el vídeo (p. ej. HEVC sin
    // decodificación por hardware), se reintenta transcodificando.
    if (!s.forced && s.info.video) {
      osd.show("Formato no compatible: convirtiendo…", 3000);
      void openSource(s.path, { start: timeRef.current, audioTrack: s.audioTrack, forceTranscode: true });
      return;
    }
    setLoading(false);
    setError(`No se puede reproducir este archivo${v.error?.message ? `: ${v.error.message}` : "."}`);
  };

  // ------------------------------------------------------------------ UI

  const hasMedia = source != null;
  const hideCursor = hasMedia && !controlsVisible;

  return (
    <div
      className={`app ${hideCursor ? "hide-cursor" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
      onMouseMove={poke}
      onWheel={(e) => {
        if (!hasMedia || showPlaylist || showTracks) return;
        const nv = changeVolume((muted ? 0 : volume) + (e.deltaY < 0 ? 0.05 : -0.05));
        osd.show(`Volumen ${Math.round(nv * 100)} %`);
      }}
    >
      <main className="stage" onDoubleClick={() => hasMedia && void toggleFullscreen()}>
        <video
          ref={(el) => {
            videoRef.current = el;
            setVideoEl(el);
          }}
          className={hasMedia ? "" : "invisible"}
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={onLoadedMetadata}
          onLoadedData={() => setLoading(false)}
          onPlay={() => setPaused(false)}
          onPause={() => {
            setPaused(true);
            void persistPosition();
          }}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onError={onError}
        />

        {!hasMedia && !loading && (
          <EmptyState
            recents={recents}
            backendError={backendError}
            onOpen={() => void openFiles()}
            onOpenRecent={(p) => void addPaths([p])}
          />
        )}

        {(loading || buffering) && (
          <div className="spinner-wrap">
            <div className="spinner" />
            {loading && <p>Preparando…</p>}
          </div>
        )}

        {error && (
          <div className="error-toast" role="alert">
            {error}
            <button className="icon-btn" onClick={() => setError(null)}>×</button>
          </div>
        )}

        {osd.message && <div className="osd">{osd.message}</div>}

        {dragging && <div className="drop-overlay">Suelta para reproducir</div>}

        {hasMedia && (
          <Controls
            visible={controlsVisible}
            paused={paused}
            time={time}
            duration={duration}
            availableEnd={availableEnd}
            volume={volume}
            muted={muted}
            rate={rate}
            mode={source?.mode ?? null}
            fullscreen={fullscreen}
            hasPrev={index != null && index > 0}
            hasNext={index != null && index < items.length - 1}
            onTogglePlay={togglePlay}
            onSeek={seekTo}
            onVolume={changeVolume}
            onToggleMute={() => setMuted((m) => !m)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToggleFullscreen={() => void toggleFullscreen()}
            onTogglePlaylist={() => setShowPlaylist((x) => !x)}
            onToggleTracks={() => setShowTracks((x) => !x)}
            onOpen={() => void openFiles()}
          />
        )}

        {showTracks && source && (
          <TrackMenu
            audio={source.info.audio}
            audioTrack={source.audioTrack}
            subtitles={subOptions}
            activeSubtitle={activeSub}
            subtitleDelay={subDelay}
            rate={rate}
            onAudio={selectAudio}
            onSubtitle={(id) => void selectSubtitle(id)}
            onLoadSubtitleFile={() => void pickSubtitleFile()}
            onDelay={(d) => setSubDelay(d == null ? 0 : Math.round((subDelay + d) * 100) / 100)}
            onRate={setRate}
            onClose={() => setShowTracks(false)}
          />
        )}
      </main>

      {showPlaylist && (
        <Playlist
          items={items}
          current={index}
          onPlay={(i) => playIndex(i)}
          onRemove={(i) => {
            const next = items.filter((_, j) => j !== i);
            setItems(next);
            if (index === i) void stopAll();
            else if (index != null && i < index) setIndex(index - 1);
          }}
          onClear={() => {
            setItems([]);
            void stopAll();
          }}
          onClose={() => setShowPlaylist(false)}
        />
      )}
    </div>
  );
}
