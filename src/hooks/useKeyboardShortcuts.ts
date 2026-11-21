import { useEffect, useRef } from "react";
import { keyToAction, type Action } from "../lib/shortcuts";

/**
 * Escucha el teclado y despacha acciones estilo VLC. El manejador se guarda en
 * una ref para usar siempre la versión más reciente sin volver a suscribirse.
 */
export function useKeyboardShortcuts(handler: (a: Action) => void) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const action = keyToAction(e);
      if (!action) return;
      e.preventDefault();
      ref.current(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
