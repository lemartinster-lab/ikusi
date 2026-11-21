import { abActive, abJumpTarget, abNext, AB_EMPTY } from "../lib/abLoop";
import { addBookmark, bookmarksToMarkdown, newBookmark, removeBookmark, updateNote } from "../lib/bookmarks";
import { normalizeSettings, toIso1, DEFAULT_SETTINGS } from "../lib/settings";
import { keyToAction } from "../lib/shortcuts";
import { activeCues, cueSegments, parseVtt, serializeSrt, serializeVtt, stripTags } from "../lib/vtt";

describe("vtt", () => {
  const VTT = "WEBVTT\n\nNOTE comentario\n\n00:00:05.000 --> 00:00:07.000 line:-3\nBi\n\n1\n00:00:01.000 --> 00:00:03.500\nBat\n<i>lehena</i>\n\n00:02.000 --> 00:04.000\nSolapa\n";

  it("parsea, ignora notas y ajustes, y ordena por inicio", () => {
    const cues = parseVtt(VTT);
    expect(cues.map((c) => c.text)).toEqual(["Bat\n<i>lehena</i>", "Solapa", "Bi"]);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5 });
    expect(cues[1].start).toBe(2);
  });

  it("acepta SRT", () => {
    const cues = parseVtt("1\r\n00:00:01,500 --> 00:00:02,000\r\nKaixo\r\n");
    expect(cues).toEqual([{ start: 1.5, end: 2, text: "Kaixo" }]);
  });

  it("encuentra los cues activos, incluidos los solapados", () => {
    const cues = parseVtt(VTT);
    expect(activeCues(cues, 0.5)).toEqual([]);
    expect(activeCues(cues, 2.5).map((c) => c.text)).toEqual(["Bat\n<i>lehena</i>", "Solapa"]);
    expect(activeCues(cues, 4.5)).toEqual([]);
    expect(activeCues(cues, 6).map((c) => c.text)).toEqual(["Bi"]);
    expect(activeCues([], 1)).toEqual([]);
  });

  it("serializa a VTT y SRT ida y vuelta", () => {
    const cues = parseVtt(VTT);
    expect(parseVtt(serializeVtt(cues))).toEqual(cues);
    const srt = serializeSrt(cues);
    expect(srt.startsWith("1\n00:00:01,000 --> 00:00:03,500\nBat\nlehena\n")).toBe(true);
    expect(parseVtt(srt).length).toBe(3);
  });

  it("convierte formato en segmentos seguros", () => {
    expect(cueSegments("Hola <i>mundo</i>\n<b>fuerte</b> &amp; <c.amarillo>listo</c>")).toEqual([
      [
        { text: "Hola ", italic: false, bold: false, underline: false },
        { text: "mundo", italic: true, bold: false, underline: false },
      ],
      [
        { text: "fuerte", italic: false, bold: true, underline: false },
        { text: " & ", italic: false, bold: false, underline: false },
        { text: "listo", italic: false, bold: false, underline: false },
      ],
    ]);
    expect(cueSegments("<script>alert(1)</script>")[0].map((s) => s.text).join("")).toBe("alert(1)");
    expect(stripTags("<v Ane>Kaixo</v> &lt;3")).toBe("Kaixo <3");
  });
});

describe("repetición A-B", () => {
  it("marca A, luego B, luego se quita", () => {
    let s = abNext(AB_EMPTY, 10);
    expect(s).toEqual({ a: 10, b: null });
    expect(abActive(s)).toBe(false);
    expect(abNext(s, 10.1)).toEqual(s); // B demasiado cerca: se ignora
    s = abNext(s, 15);
    expect(s).toEqual({ a: 10, b: 15 });
    expect(abActive(s)).toBe(true);
    expect(abNext(s, 20)).toEqual(AB_EMPTY);
  });

  it("salta a A al pasar de B o si se ha ido muy atrás", () => {
    const s = { a: 10, b: 15 };
    expect(abJumpTarget(s, 12)).toBeNull();
    expect(abJumpTarget(s, 15.02)).toBe(10);
    expect(abJumpTarget(s, 3)).toBe(10);
    expect(abJumpTarget({ a: 10, b: null }, 99)).toBeNull();
  });
});

describe("marcadores", () => {
  it("añade ordenado, edita y borra", () => {
    let list = addBookmark([], newBookmark(30, undefined, undefined, "b"));
    list = addBookmark(list, newBookmark(5, "Kaixo", undefined, "a"));
    expect(list.map((b) => b.id)).toEqual(["a", "b"]);
    list = updateNote(list, "b", "Escena del puerto");
    expect(list[1].note).toBe("Escena del puerto");
    expect(removeBookmark(list, "a").map((b) => b.id)).toEqual(["b"]);
  });

  it("exporta a Markdown con citas de los subtítulos", () => {
    const md = bookmarksToMarkdown({
      title: "Proba bideoa.mkv",
      path: "/Volumes/T9/Proba bideoa.mkv",
      date: new Date(2026, 10, 21),
      bookmarks: [
        { id: "1", time: 4.2, note: "Saludo", quote: "<i>Kaixo!</i>\nZer moduz?", quote2: "¡Hola!" },
        { id: "2", time: 3725, note: "" },
      ],
    });
    expect(md).toBe(
      [
        "# Proba bideoa.mkv",
        "",
        "> Marcadores de Ikusi · `/Volumes/T9/Proba bideoa.mkv` · 21/11/2026",
        "",
        "- **0:04** — Saludo",
        "  > Kaixo!",
        "  > Zer moduz?",
        "  > *¡Hola!*",
        "- **1:02:05**",
        "",
      ].join("\n"),
    );
  });
});

describe("ajustes", () => {
  it("rellena valores que faltan y descarta los inválidos", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ targetLang: "eu", translationModel: "gpt-5", whisperModel: "medium", whisperLang: "auto" })).toEqual({
      targetLang: "eu",
      translationModel: "claude-haiku-5-5",
      whisperModel: "medium",
      whisperLang: "auto",
    });
  });

  it("convierte códigos de idioma de Matroska", () => {
    expect(toIso1("baq")).toBe("eu");
    expect(toIso1("spa")).toBe("es");
    expect(toIso1("EN")).toBe("en");
    expect(toIso1("swe")).toBeNull();
    expect(toIso1(null)).toBeNull();
  });
});

describe("atajos nuevos", () => {
  it("R, K y Cmd+,", () => {
    expect(keyToAction({ key: "r" })).toEqual({ type: "abLoop" });
    expect(keyToAction({ key: "K" })).toEqual({ type: "addBookmark" });
    expect(keyToAction({ key: ",", metaKey: true })).toEqual({ type: "settings" });
    expect(keyToAction({ key: "r", metaKey: true })).toBeNull(); // Cmd+R no se intercepta
  });
});
