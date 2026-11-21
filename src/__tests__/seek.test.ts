import { planSeek } from "../lib/seek";

describe("planSeek", () => {
  it("en modo directo siempre salta localmente, acotado a la duración", () => {
    const ctx = { mode: "direct" as const, offset: 0, duration: 100, seekableEnd: 100 };
    expect(planSeek(50, ctx)).toEqual({ kind: "local", time: 50 });
    expect(planSeek(-5, ctx)).toEqual({ kind: "local", time: 0 });
    expect(planSeek(500, ctx)).toEqual({ kind: "local", time: 99.75 });
  });

  it("en HLS salta localmente dentro de lo ya generado", () => {
    const ctx = { mode: "remux" as const, offset: 0, duration: 7200, seekableEnd: 300 };
    expect(planSeek(120, ctx)).toEqual({ kind: "local", time: 120 });
  });

  it("en HLS reinicia ffmpeg si el destino aún no existe", () => {
    const ctx = { mode: "transcode" as const, offset: 0, duration: 7200, seekableEnd: 60 };
    expect(planSeek(3600.7, ctx)).toEqual({ kind: "reload", start: 3600 });
  });

  it("tiene en cuenta el desplazamiento de una sesión que empezó a mitad", () => {
    const ctx = { mode: "transcode" as const, offset: 1800, duration: 7200, seekableEnd: 120 };
    expect(planSeek(1850, ctx)).toEqual({ kind: "local", time: 50 });
    // Antes del inicio de la sesión: hay que volver a generar desde ahí
    expect(planSeek(600, ctx)).toEqual({ kind: "reload", start: 600 });
  });

  it("sin duración conocida no acota por arriba", () => {
    const ctx = { mode: "direct" as const, offset: 0, duration: null, seekableEnd: 0 };
    expect(planSeek(9999, ctx)).toEqual({ kind: "local", time: 9999 });
  });
});
