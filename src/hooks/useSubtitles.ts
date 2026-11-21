import { useCallback, useRef, useState } from "react";
import { api } from "../lib/playbackApi";
import { toIso1 } from "../lib/settings";
import { subtitleLabel } from "../lib/tracks";
import type { MediaInfo } from "../lib/types";
import { parseVtt, type Cue } from "../lib/vtt";

export interface SubtitleOption {
  id: string;
  label: string;
  /** Código ISO 639-1 si se conoce ("eu", "es"…). */
  language: string | null;
  source: { kind: "embedded"; streamIndex: number } | { kind: "text"; vtt: string };
  disabled?: boolean;
}

export type Slot = "primary" | "secondary";

interface Osd {
  show: (text: string, ms?: number) => void;
}

/**
 * Estado de subtítulos: opciones disponibles (incrustadas, archivos externos,
 * generadas, traducidas) y qué va en la línea principal y en la segunda línea
 * (modo estudio). El WebVTT de cada opción se carga una sola vez.
 */
export function useSubtitles(getPath: () => string | null, osd: Osd) {
  const [options, setOptions] = useState<SubtitleOption[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const [cues, setCues] = useState<Record<string, Cue[]>>({});

  const optionsRef = useRef(options);
  optionsRef.current = options;
  const vtts = useRef(new Map<string, string>());
  const ids = useRef({ primary: primaryId, secondary: secondaryId });
  ids.current = { primary: primaryId, secondary: secondaryId };

  const reset = useCallback((info: MediaInfo | null) => {
    vtts.current.clear();
    setCues({});
    setPrimaryId(null);
    setSecondaryId(null);
    setDelay(0);
    setOptions(
      info?.subtitles.map((s, i) => ({
        id: `emb:${s.index}`,
        label: subtitleLabel(s, i),
        language: toIso1(s.language),
        source: { kind: "embedded", streamIndex: s.index },
        disabled: !s.textBased,
      })) ?? [],
    );
  }, []);

  /** WebVTT de una opción, extrayéndolo del archivo si hace falta. */
  const loadVtt = useCallback(
    async (opt: SubtitleOption): Promise<string | null> => {
      const cached = vtts.current.get(opt.id);
      if (cached) return cached;
      if (opt.source.kind === "text") return opt.source.vtt;
      const path = getPath();
      if (!path) return null;
      osd.show("Cargando subtítulos…", 15000);
      try {
        const vtt = await api.extractSubtitle(path, opt.source.streamIndex);
        vtts.current.set(opt.id, vtt);
        return vtt;
      } catch (e) {
        osd.show(String(e), 3500);
        return null;
      }
    },
    [getPath, osd],
  );

  const select = useCallback(
    async (slot: Slot, id: string | null, quiet = false) => {
      const setSlot = slot === "primary" ? setPrimaryId : setSecondaryId;
      if (id === null) {
        setSlot(null);
        if (!quiet) osd.show(slot === "primary" ? "Subtítulos desactivados" : "Segunda línea desactivada");
        return;
      }
      const opt = optionsRef.current.find((o) => o.id === id);
      if (!opt || opt.disabled) return;
      const vtt = await loadVtt(opt);
      if (!vtt) return;
      setCues((prev) => (prev[id] ? prev : { ...prev, [id]: parseVtt(vtt) }));
      // La misma pista no puede ir en las dos líneas.
      const other = slot === "primary" ? ids.current.secondary : ids.current.primary;
      if (other === id) (slot === "primary" ? setSecondaryId : setPrimaryId)(null);
      setSlot(id);
      if (!quiet) osd.show(`${slot === "primary" ? "Subtítulos" : "Segunda línea"}: ${opt.label}`);
    },
    [loadVtt, osd],
  );

  /** Añade subtítulos generados, traducidos o de archivo, y opcionalmente los activa. */
  const addText = useCallback(
    (opt: { id: string; label: string; language: string | null; vtt: string }, slot?: Slot) => {
      vtts.current.set(opt.id, opt.vtt);
      const option: SubtitleOption = { ...opt, source: { kind: "text", vtt: opt.vtt } };
      optionsRef.current = [...optionsRef.current.filter((o) => o.id !== opt.id), option];
      setOptions(optionsRef.current);
      setCues((prev) => ({ ...prev, [opt.id]: parseVtt(opt.vtt) }));
      if (slot) void select(slot, opt.id, true);
    },
    [select],
  );

  const cycle = useCallback(() => {
    const list = [null, ...optionsRef.current.filter((o) => !o.disabled).map((o) => o.id)];
    if (list.length === 1) {
      osd.show("No hay subtítulos disponibles");
      return;
    }
    const i = list.indexOf(ids.current.primary);
    void select("primary", list[(i + 1) % list.length]);
  }, [select, osd]);

  const getVtt = useCallback(async (id: string) => {
    const opt = optionsRef.current.find((o) => o.id === id);
    return opt ? loadVtt(opt) : null;
  }, [loadVtt]);

  return {
    options,
    primaryId,
    secondaryId,
    delay,
    setDelay,
    primary: optionsRef.current.find((o) => o.id === primaryId) ?? null,
    primaryCues: primaryId ? cues[primaryId] ?? null : null,
    secondaryCues: secondaryId ? cues[secondaryId] ?? null : null,
    reset,
    select,
    addText,
    cycle,
    getVtt,
  };
}
