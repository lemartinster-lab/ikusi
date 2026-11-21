import { useCallback, useRef, useState } from "react";

/** Mensajes en pantalla tipo VLC ("Volumen 80 %") que desaparecen solos. */
export function useOsd(duration = 1600) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback(
    (text: string, ms = duration) => {
      setMessage(text);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), ms);
    },
    [duration],
  );

  return { message, show };
}
