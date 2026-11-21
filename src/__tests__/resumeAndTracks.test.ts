import { loadResume, memoryStore, pushRecent, saveResume, shouldResume, MAX_RECENTS } from "../lib/resume";
import { audioLabel, languageName, subtitleLabel } from "../lib/tracks";

describe("shouldResume", () => {
  it("solo reanuda entre los primeros segundos y el final", () => {
    expect(shouldResume(5, 3600)).toBe(false);
    expect(shouldResume(600, 3600)).toBe(true);
    expect(shouldResume(3590, 3600)).toBe(false);
    expect(shouldResume(30, 45)).toBe(false); // archivo corto
    expect(shouldResume(30, null)).toBe(true);
    expect(shouldResume(NaN, 3600)).toBe(false);
  });
});

describe("guardar y recuperar la posición", () => {
  it("guarda una posición útil y la borra al terminar", async () => {
    const store = memoryStore();
    await saveResume(store, "/p.mkv", 754, 5000, 1);
    expect(await loadResume(store, "/p.mkv")).toBe(754);

    await saveResume(store, "/p.mkv", 4995, 5000);
    expect(await loadResume(store, "/p.mkv")).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("no reanuda archivos desconocidos", async () => {
    expect(await loadResume(memoryStore(), "/nuevo.mp4")).toBeNull();
  });
});

describe("recientes", () => {
  it("sube al principio sin duplicar y con tope", () => {
    expect(pushRecent(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
    const many = Array.from({ length: 30 }, (_, i) => `/f${i}`);
    expect(pushRecent(many, "/nuevo")).toHaveLength(MAX_RECENTS);
  });
});

describe("etiquetas de pistas", () => {
  it("traduce idiomas habituales, incluido euskera", () => {
    expect(languageName("spa")).toBe("Español");
    expect(languageName("baq")).toBe("Euskera");
    expect(languageName("eus")).toBe("Euskera");
    expect(languageName("swe")).toBe("SWE");
    expect(languageName(null)).toBeNull();
  });

  it("describe audio y subtítulos", () => {
    const a = { index: 1, codec: "ac3", channels: 6, language: "spa", title: null, default: true };
    expect(audioLabel(a, 0)).toBe("Español · Dolby Digital 5.1");
    const b = { ...a, title: "Comentarios", codec: "aac", channels: 2 };
    expect(audioLabel(b, 1)).toBe("Comentarios · AAC estéreo");

    const s = { index: 3, codec: "subrip", language: "spa", title: "Forzados", default: false, textBased: true };
    expect(subtitleLabel(s, 0)).toBe("Español — Forzados");
    expect(subtitleLabel({ ...s, textBased: false, title: null }, 1)).toBe("Español (imagen, no disponible)");
  });
});
