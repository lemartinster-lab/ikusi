import { useEffect, useRef, useState, type RefObject } from "react";
import { activeCues, cueSegments, type Cue } from "../lib/vtt";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Segundo del original en el que empieza la fuente (sesiones HLS a mitad). */
  offset: number;
  primary: Cue[] | null;
  /** Segunda línea (modo estudio): p. ej. la traducción. */
  secondary: Cue[] | null;
  /** Retardo del usuario: positivo = los subtítulos salen más tarde. */
  delay: number;
  /** Subir los subtítulos cuando los controles están visibles. */
  raised: boolean;
}

function Lines({ text, className }: { text: string; className: string }) {
  return (
    <div className={className}>
      {cueSegments(text).map((line, i) => (
        <div key={i} className="sub-line">
          <span className="sub-box">
            {line.map((s, j) => (
              <span
                key={j}
                style={{
                  fontStyle: s.italic ? "italic" : undefined,
                  fontWeight: s.bold ? 700 : undefined,
                  textDecoration: s.underline ? "underline" : undefined,
                }}
              >
                {s.text}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Capa propia de subtítulos. Lee `currentTime` en cada fotograma (más preciso
 * que el evento timeupdate, que llega ~4 veces por segundo) y solo vuelve a
 * pintar cuando cambia el texto visible.
 */
export function SubtitleOverlay({ videoRef, offset, primary, secondary, delay, raised }: Props) {
  const [texts, setTexts] = useState<[string, string]>(["", ""]);
  const last = useRef<[string, string]>(["", ""]);

  useEffect(() => {
    if (!primary && !secondary) {
      last.current = ["", ""];
      setTexts(["", ""]);
      return;
    }
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = offset + v.currentTime - delay;
        const p = primary ? activeCues(primary, t).map((c) => c.text).join("\n") : "";
        const s = secondary ? activeCues(secondary, t).map((c) => c.text).join("\n") : "";
        if (p !== last.current[0] || s !== last.current[1]) {
          last.current = [p, s];
          setTexts([p, s]);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, offset, primary, secondary, delay]);

  if (!texts[0] && !texts[1]) return null;
  return (
    <div className={`subtitles ${raised ? "raised" : ""}`} aria-live="off">
      {texts[0] && <Lines text={texts[0]} className="sub-primary" />}
      {texts[1] && <Lines text={texts[1]} className="sub-secondary" />}
    </div>
  );
}
