import { keyToAction, nextSpeed } from "../lib/shortcuts";

describe("keyToAction (atajos estilo VLC)", () => {
  it("espacio reproduce/pausa", () => {
    expect(keyToAction({ key: " " })).toEqual({ type: "togglePlay" });
  });

  it("las flechas saltan 10 s, 3 s con Mayús y 60 s con Cmd/Ctrl", () => {
    expect(keyToAction({ key: "ArrowRight" })).toEqual({ type: "seekBy", seconds: 10 });
    expect(keyToAction({ key: "ArrowLeft" })).toEqual({ type: "seekBy", seconds: -10 });
    expect(keyToAction({ key: "ArrowRight", shiftKey: true })).toEqual({ type: "seekBy", seconds: 3 });
    expect(keyToAction({ key: "ArrowLeft", metaKey: true })).toEqual({ type: "seekBy", seconds: -60 });
    expect(keyToAction({ key: "ArrowRight", ctrlKey: true })).toEqual({ type: "seekBy", seconds: 60 });
  });

  it("volumen, silencio y pantalla completa (mayúsculas o minúsculas)", () => {
    expect(keyToAction({ key: "ArrowUp" })).toEqual({ type: "volumeBy", delta: 0.05 });
    expect(keyToAction({ key: "m" })).toEqual({ type: "toggleMute" });
    expect(keyToAction({ key: "F" })).toEqual({ type: "toggleFullscreen" });
    expect(keyToAction({ key: "Escape" })).toEqual({ type: "exitFullscreen" });
  });

  it("pistas y retardo de subtítulos con las teclas de VLC", () => {
    expect(keyToAction({ key: "v" })).toEqual({ type: "cycleSubtitles" });
    expect(keyToAction({ key: "b" })).toEqual({ type: "cycleAudio" });
    expect(keyToAction({ key: "g" })).toEqual({ type: "subtitleDelay", delta: -0.1 });
    expect(keyToAction({ key: "h" })).toEqual({ type: "subtitleDelay", delta: 0.1 });
  });

  it("Cmd+O abre; otros atajos con Cmd se dejan al sistema", () => {
    expect(keyToAction({ key: "o", metaKey: true })).toEqual({ type: "open" });
    expect(keyToAction({ key: "q", metaKey: true })).toBeNull();
    expect(keyToAction({ key: "f", metaKey: true })).toBeNull();
  });

  it("ignora teclas sin función", () => {
    expect(keyToAction({ key: "z" })).toBeNull();
    expect(keyToAction({ key: "Shift" })).toBeNull();
  });
});

describe("nextSpeed", () => {
  it("sube y baja por la escala con topes", () => {
    expect(nextSpeed(1, 1)).toBe(1.25);
    expect(nextSpeed(1, -1)).toBe(0.75);
    expect(nextSpeed(3, 1)).toBe(3);
    expect(nextSpeed(0.25, -1)).toBe(0.25);
  });

  it("encaja velocidades intermedias y vuelve a 1×", () => {
    expect(nextSpeed(1.1, 1)).toBe(1.25);
    expect(nextSpeed(1.1, -1)).toBe(1);
    expect(nextSpeed(2, 0)).toBe(1);
  });
});
