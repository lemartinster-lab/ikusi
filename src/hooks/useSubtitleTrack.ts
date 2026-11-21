import { useEffect, useRef } from "react";

/**
 * Pinta subtítulos WebVTT sobre el <video> con un <track> y aplica un
 * desplazamiento a todos los cues.
 *
 * El desplazamiento combina dos cosas:
 * - el retardo que elige el usuario (teclas G/H), y
 * - el `offset` de la sesión HLS: si ffmpeg empezó en el minuto 30, el
 *   `currentTime` del vídeo es 0 en ese punto, así que los subtítulos (que
 *   están en tiempo del archivo original) deben restar 30 min.
 */
export function useSubtitleTrack(
  video: HTMLVideoElement | null,
  vtt: string | null,
  shift: number,
  sourceKey: string,
) {
  const trackRef = useRef<HTMLTrackElement | null>(null);
  const originals = useRef(new WeakMap<TextTrackCue, [number, number]>());
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  const applyShift = (track: TextTrack) => {
    const cues = track.cues;
    if (!cues) return;
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      let orig = originals.current.get(cue);
      if (!orig) {
        orig = [cue.startTime, cue.endTime];
        originals.current.set(cue, orig);
      }
      cue.startTime = Math.max(0, orig[0] + shiftRef.current);
      cue.endTime = Math.max(0, orig[1] + shiftRef.current);
      // Subir los subtítulos para que no queden bajo la barra de controles.
      if ("line" in cue) (cue as VTTCue).line = -4;
    }
  };

  // Crear el <track> al cambiar de subtítulos o de fuente de vídeo.
  useEffect(() => {
    if (!video || !vtt) return;
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    const el = document.createElement("track");
    el.kind = "subtitles";
    el.label = "Ikusi";
    el.srclang = "es";
    el.default = true;
    el.src = url;
    const onLoad = () => {
      el.track.mode = "showing";
      applyShift(el.track);
    };
    el.addEventListener("load", onLoad);
    video.appendChild(el);
    el.track.mode = "showing";
    trackRef.current = el;
    return () => {
      el.removeEventListener("load", onLoad);
      el.track.mode = "disabled";
      el.remove();
      URL.revokeObjectURL(url);
      if (trackRef.current === el) trackRef.current = null;
    };
  }, [video, vtt, sourceKey]);

  // Reaplicar el desplazamiento cuando cambia.
  useEffect(() => {
    if (trackRef.current) applyShift(trackRef.current.track);
  }, [shift]);
}
