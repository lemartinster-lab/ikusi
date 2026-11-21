// Repetición A‑B (tecla R, como el botón de bucle de VLC): primera pulsación
// marca A, segunda marca B y empieza el bucle, tercera lo quita.

export interface AbState {
  a: number | null;
  b: number | null;
}

export const AB_EMPTY: AbState = { a: null, b: null };

/** Tramo mínimo para que un bucle tenga sentido. */
const MIN_LENGTH = 0.3;

export function abNext(state: AbState, t: number): AbState {
  if (state.a == null) return { a: t, b: null };
  if (state.b == null) return t > state.a + MIN_LENGTH ? { a: state.a, b: t } : state;
  return AB_EMPTY;
}

export function abActive(state: AbState): state is { a: number; b: number } {
  return state.a != null && state.b != null;
}

/** Si el bucle está activo y se ha pasado de B, devuelve A (a dónde saltar). */
export function abJumpTarget(state: AbState, t: number): number | null {
  return abActive(state) && (t >= state.b || t < state.a - 1) ? state.a : null;
}
