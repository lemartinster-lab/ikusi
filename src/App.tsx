import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { AiTaskToast } from "./components/AiTaskToast";
import { Controls } from "./components/Controls";
import { EmptyState } from "./components/EmptyState";
import { SettingsPanel } from "./components/SettingsPanel";
import { SidePanel, type SideTab } from "./components/SidePanel";
import { SubtitleOverlay } from "./components/SubtitleOverlay";
import { TrackMenu } from "./components/TrackMenu";
import { useAutoHide } from "./hooks/useAutoHide";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useOsd } from "./hooks/useOsd";
import { useSubtitles } from "./hooks/useSubtitles";
import { abActive, abJumpTarget, abNext, AB_EMPTY, type AbState } from "./lib/abLoop";
import { aiApi, onAiProgress, type AiProgress } from "./lib/aiApi";
import {
  addBookmark, bookmarksKey, bookmarksToMarkdown, newBookmark, removeBookmark, updateNote, type Bookmark,
} from "./lib/bookmarks";
import { formatDelay, formatTime } from "./lib/formatTime";
import { api, type OpenOptions } from "./lib/playbackApi";
import {
  addRecent, getRecents, getSettings, getVolume, kv, saveSettings, setVolume as persistVolume,
} from "./lib/persist";
import {
  AUDIO_EXTENSIONS, fileName, isSubtitlePath, mergePlaylist, stepIndex, SUBTITLE_EXTENSIONS, toPlaylist,
  VIDEO_EXTENSIONS, type PlaylistItem,
} from "./lib/playlist";
import { loadResume, saveResume } from "./lib/resume";
import { planSeek } from "./lib/seek";
import { DEFAULT_SETTINGS, LANGUAGES, type Settings } from "./lib/settings";
import { nextSpeed, type Action } from "./lib/shortcuts";
import { srtToVtt } from "./lib/srtToVtt";
import { audioLabel } from "./lib/tracks";
import type { PlaybackSource } from "./lib/types";
import { activeCues, serializeSrt, serializeVtt, type Cue } from "./lib/vtt";

type Source = PlaybackSource & { path: string; forced: boolean };

const SAVE_EVERY_MS = 5000;

const langName = (code: string) => LANGUAGES.find((l) => l.code === code)?.name ?? code;
const baseName = (path: string) => fileName(path).replace(/\.[^.]+$/, "");
const textAt = (cues: Cue[] | null, t: number) => (cues ? activeCues(cues, t).map((c) => c.text).join("\n") : "");

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
  const [dragging, setDragging] = useState(false);

  // --- Paneles ---
  const [showSide, setShowSide] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("playlist");
  const [showTracks, setShowTracks] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // --- Fase 2 ---
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ab, setAb] = useState<AbState>(AB_EMPTY);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [aiTask, setAiTask] = useState<{ starting: string; progress: AiProgress | null } | null>(null);

  const osd = useOsd();
  const { visible: controlsVisible, poke } = useAutoHide(!paused && !showTracks && !loading && !showSettings);

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

  const getPath = useCallback(() => sourceRef.current?.path ?? null, []);
  const subs = useSubtitles(getPath, osd);

  const current = index != null ? items[index] ?? null : null;
  const duration = source?.info.duration ?? null;

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
      subs.reset(null);
      setShowTracks(false);
      setAb(AB_EMPTY);
      setBookmarks((await kv.get<Bookmark[]>(bookmarksKey(path)).catch(() => undefined)) ?? []);

      const resumeAt = await loadResume(kv, path).catch(() => null);
      addRecent(path).then(setRecents).catch(() => {});
      const src = await openSource(path, { start: resumeAt ?? 0 });
      if (!src) return;
      subs.reset(src.info);
      if (resumeAt) osd.show(`Reanudando en ${formatTime(resumeAt)}`, 2500);
    },
    [openSource, persistPosition, osd, subs.reset],
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
    setAb(AB_EMPTY);
    setBookmarks([]);
    subs.reset(null);
    await api.stopPlayback().catch(() => {});
  }, [persistPosition, subs.reset]);

  const loadSubtitleFile = useCallback(
    async (path: string) => {
      if (!sourceRef.current) {
        osd.show("Abre primero un vídeo para añadirle subtítulos");
        return;
      }
      try {
        const f = await api.loadSubtitleFile(path);
        const vtt = f.format === "srt" ? srtToVtt(f.text) : f.text;
        subs.addText({ id: `ext:${path}`, label: fileName(path), language: null, vtt }, "primary");
        osd.show(`Subtítulos: ${fileName(path)}`);
      } catch (e) {
        osd.show(String(e), 3500);
      }
    },
    [osd, subs.addText],
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

  const changeVolume = useCallback((v: number) => {
    const clamped = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    setVolume(clamped);
    setMuted(false);
    void persistVolume(clamped).catch(() => {});
    return clamped;
  }, []);

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

  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    void saveSettings(s).catch(() => {});
  }, []);

  // ---------------------------------------------------- marcadores y A-B

  const persistBookmarks = useCallback((path: string, list: Bookmark[]) => {
    setBookmarks(list);
    void (list.length ? kv.set(bookmarksKey(path), list) : kv.delete(bookmarksKey(path))).catch(() => {});
  }, []);

  const markNow = useCallback(() => {
    const s = sourceRef.current;
    if (!s) return;
    const t = timeRef.current;
    const b = newBookmark(t, textAt(subs.primaryCues, t - subs.delay), textAt(subs.secondaryCues, t - subs.delay));
    persistBookmarks(s.path, addBookmark(bookmarks, b));
    osd.show(`Marcador en ${formatTime(t)}`);
  }, [bookmarks, persistBookmarks, osd, subs.primaryCues, subs.secondaryCues, subs.delay]);

  const bookmarksMarkdown = () =>
    bookmarksToMarkdown({ title: current?.name ?? "Ikusi", path: source?.path ?? "", bookmarks });

  const exportBookmarks = async () => {
    if (!source) return;
    const path = await saveDialog({
      title: "Exportar marcadores",
      defaultPath: `${baseName(source.path)} — marcadores.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      await aiApi.saveTextFile(path, bookmarksMarkdown());
      osd.show(`Guardado: ${fileName(path)}`);
    } catch (e) {
      setError(String(e));
    }
  };

  const copyBookmarks = async () => {
    try {
      await navigator.clipboard.writeText(bookmarksMarkdown());
      osd.show("Marcadores copiados en Markdown");
    } catch {
      osd.show("No se pudo copiar; usa Exportar");
    }
  };

  const saveSubtitles = async () => {
    if (!source || !subs.primaryCues) return;
    const path = await saveDialog({
      title: "Guardar subtítulos",
      defaultPath: `${baseName(source.path)}.srt`,
      filters: [
        { name: "SubRip", extensions: ["srt"] },
        { name: "WebVTT", extensions: ["vtt"] },
      ],
    });
    if (!path) return;
    const text = path.toLowerCase().endsWith(".vtt") ? serializeVtt(subs.primaryCues) : serializeSrt(subs.primaryCues);
    try {
      await aiApi.saveTextFile(path, text);
      osd.show(`Guardado: ${fileName(path)}`);
    } catch (e) {
      setError(String(e));
    }
  };

  // Bucle A‑B: comprobar en cada fotograma (el evento timeupdate es demasiado lento).
  useEffect(() => {
    if (!abActive(ab)) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      const s = sourceRef.current;
      if (v && s && !v.paused) {
        const target = abJumpTarget(ab, s.offset + v.currentTime);
        if (target != null) seekTo(target);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ab, seekTo]);

  // ------------------------------------------------------------- IA

  const runAiTask = useCallback(
    async <T,>(starting: string, task: () => Promise<T>): Promise<T | null> => {
      setAiTask({ starting, progress: null });
      try {
        return await task();
      } catch (e) {
        const msg = String(e);
        if (msg.includes("Cancelado")) osd.show("Tarea cancelada");
        else setError(msg);
        return null;
      } finally {
        setAiTask(null);
      }
    },
    [osd],
  );

  const translate = async () => {
    const s = sourceRef.current;
    const opt = subs.primary;
    if (!s || !opt) {
      osd.show("Activa antes unos subtítulos para traducirlos");
      return;
    }
    const target = settings.targetLang;
    if (opt.language === target) {
      osd.show(`Estos subtítulos ya están en ${langName(target).toLowerCase()}`);
      return;
    }
    const key = await aiApi.keyStatus().catch(() => null);
    if (!key?.configured) {
      setShowSettings(true);
      osd.show("Añade tu clave de API de Claude para traducir", 3000);
      return;
    }
    const vtt = await subs.getVtt(opt.id);
    if (!vtt) return;
    setShowTracks(false);
    const out = await runAiTask("Traduciendo con Claude", () =>
      aiApi.translate({ vtt, sourceLang: opt.language, targetLang: target, model: settings.translationModel, title: fileName(s.path) }),
    );
    if (out == null) return;
    subs.addText({ id: `tr:${opt.id}:${target}`, label: `${langName(target)} (traducido)`, language: target, vtt: out }, "secondary");
    osd.show(`Traducción lista: ${langName(target)} en la segunda línea`, 3000);
  };

  const transcribe = async () => {
    const s = sourceRef.current;
    if (!s) return;
    const status = await aiApi.whisperStatus().catch(() => null);
    const model = status?.models.find((m) => m.name === settings.whisperModel);
    if (!status?.binary || !model?.downloaded) {
      setShowSettings(true);
      osd.show(!status?.binary ? "Falta instalar whisper-cpp (ver Ajustes)" : `Descarga el modelo «${settings.whisperModel}» en Ajustes`, 3500);
      return;
    }
    setShowTracks(false);
    const lang = settings.whisperLang;
    const out = await runAiTask("Preparando Whisper", () =>
      aiApi.transcribe({ path: s.path, audioTrack: s.audioTrack, language: lang, model: settings.whisperModel }),
    );
    if (out == null) return;
    const label = `${lang === "auto" ? "Automático" : langName(lang)} (Whisper)`;
    subs.addText({ id: `gen:${lang}:${s.audioTrack ?? 0}`, label, language: lang === "auto" ? null : lang, vtt: out }, "primary");
    osd.show("Subtítulos generados", 2500);
  };

  const downloadModel = async (name: string) => {
    await runAiTask("Descargando modelo", () => aiApi.downloadModel(name));
  };

  // ------------------------------------------------------------- teclado

  const handleAction = (a: Action) => {
    const v = videoRef.current;
    switch (a.type) {
      case "open":
        void openFiles();
        return;
      case "settings":
        setShowSettings((x) => !x);
        return;
      case "togglePlaylist":
        setShowSide((x) => !x);
        return;
      case "exitFullscreen":
        if (showSettings) setShowSettings(false);
        else if (showTracks) setShowTracks(false);
        else if (fullscreen) void toggleFullscreen(false);
        return;
      case "toggleFullscreen":
        void toggleFullscreen();
        return;
    }
    if (!v || !source || showSettings) return;
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
      case "cycleSubtitles":
        subs.cycle();
        break;
      case "subtitleDelay": {
        const d = Math.round((subs.delay + a.delta) * 100) / 100;
        subs.setDelay(d);
        osd.show(`Retardo de subtítulos ${formatDelay(d)}`);
        break;
      }
      case "showTime":
        osd.show(`${formatTime(timeRef.current)} / ${formatTime(duration)}`);
        break;
      case "abLoop": {
        const next = abNext(ab, timeRef.current);
        setAb(next);
        if (next.a == null) osd.show("Repetición A‑B desactivada");
        else if (next.b == null) osd.show(`A: ${formatTime(next.a)} · pulsa R otra vez para marcar B`, 2500);
        else osd.show(`Repitiendo ${formatTime(next.a)} – ${formatTime(next.b)}`, 2500);
        break;
      }
      case "addBookmark":
        markNow();
        break;
    }
  };
  useKeyboardShortcuts(handleAction);

  // ------------------------------------------------------------- efectos

  // Arranque: estado del backend, recientes, volumen, ajustes y archivos del Finder.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      setBackendError(await api.backendStatus().catch(() => null));
      setRecents(await getRecents().catch(() => []));
      setVolume(await getVolume().catch(() => 1));
      setSettings(await getSettings().catch(() => DEFAULT_SETTINGS));
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

  // Avance de las tareas de IA.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onAiProgress((p) => setAiTask((t) => (t ? { ...t, progress: p } : t))).then((u) =>
      cancelled ? u() : (unlisten = u),
    );
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
        if (!hasMedia || showSide || showTracks || showSettings) return;
        const nv = changeVolume((muted ? 0 : volume) + (e.deltaY < 0 ? 0.05 : -0.05));
        osd.show(`Volumen ${Math.round(nv * 100)} %`);
      }}
    >
      <main className="stage" onDoubleClick={() => hasMedia && void toggleFullscreen()}>
        <video
          ref={videoRef}
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

        {hasMedia && (
          <SubtitleOverlay
            videoRef={videoRef}
            offset={source.offset}
            primary={subs.primaryCues}
            secondary={subs.secondaryCues}
            delay={subs.delay}
            raised={controlsVisible}
          />
        )}

        {!hasMedia && !loading && (
          <EmptyState
            recents={recents}
            backendError={backendError}
            onOpen={() => void openFiles()}
            onOpenRecent={(p) => void addPaths([p])}
            onSettings={() => setShowSettings(true)}
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

        {aiTask && (
          <AiTaskToast progress={aiTask.progress} starting={aiTask.starting} onCancel={() => void aiApi.cancel()} />
        )}

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
            markers={bookmarks.map((b) => b.time)}
            ab={ab}
            onTogglePlay={togglePlay}
            onSeek={seekTo}
            onVolume={changeVolume}
            onToggleMute={() => setMuted((m) => !m)}
            onPrev={() => step(-1)}
            onNext={() => step(1)}
            onToggleFullscreen={() => void toggleFullscreen()}
            onTogglePlaylist={() => setShowSide((x) => !x)}
            onToggleTracks={() => setShowTracks((x) => !x)}
            onOpen={() => void openFiles()}
            onSettings={() => setShowSettings(true)}
          />
        )}

        {showTracks && source && (
          <TrackMenu
            audio={source.info.audio}
            audioTrack={source.audioTrack}
            subtitles={subs.options}
            primaryId={subs.primaryId}
            secondaryId={subs.secondaryId}
            subtitleDelay={subs.delay}
            rate={rate}
            aiBusy={aiTask != null}
            targetLang={settings.targetLang}
            whisperLang={settings.whisperLang}
            onAudio={selectAudio}
            onPrimary={(id) => void subs.select("primary", id)}
            onSecondary={(id) => void subs.select("secondary", id)}
            onLoadSubtitleFile={() => void pickSubtitleFile()}
            onSaveSubtitles={() => void saveSubtitles()}
            onDelay={(d) => subs.setDelay(d == null ? 0 : Math.round((subs.delay + d) * 100) / 100)}
            onRate={setRate}
            onTargetLang={(c) => updateSettings({ ...settings, targetLang: c })}
            onWhisperLang={(c) => updateSettings({ ...settings, whisperLang: c })}
            onTranslate={() => void translate()}
            onTranscribe={() => void transcribe()}
            onClose={() => setShowTracks(false)}
          />
        )}
      </main>

      {showSide && (
        <SidePanel
          tab={sideTab}
          onTab={setSideTab}
          onClose={() => setShowSide(false)}
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
          bookmarks={bookmarks}
          hasMedia={hasMedia}
          onJump={(t) => seekTo(t)}
          onNote={(id, note) => source && persistBookmarks(source.path, updateNote(bookmarks, id, note))}
          onDeleteBookmark={(id) => source && persistBookmarks(source.path, removeBookmark(bookmarks, id))}
          onAddBookmark={markNow}
          onExport={() => void exportBookmarks()}
          onCopy={() => void copyBookmarks()}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          busy={aiTask != null}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          onDownloadModel={downloadModel}
        />
      )}
    </div>
  );
}
