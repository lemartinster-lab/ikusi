import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Muestra los controles al mover el ratón y los oculta tras `delay` ms de
 * inactividad, solo mientras `enabled` (reproduciendo).
 */
export function useAutoHide(enabled: boolean, delay = 2500) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  const poke = useCallback(() => {
    setVisible(true);
    window.clearTimeout(timer.current);
    if (enabled) timer.current = window.setTimeout(() => setVisible(false), delay);
  }, [enabled, delay]);

  useEffect(() => {
    poke();
    return () => window.clearTimeout(timer.current);
  }, [poke]);

  return { visible: visible || !enabled, poke };
}
