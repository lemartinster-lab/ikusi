import {
  extensionOf,
  fileName,
  isMediaPath,
  isSubtitlePath,
  mergePlaylist,
  stepIndex,
  toPlaylist,
} from "../lib/playlist";

describe("playlist", () => {
  it("reconoce extensiones sin importar mayúsculas", () => {
    expect(extensionOf("/Volumes/T9/Película.MKV")).toBe("mkv");
    expect(isMediaPath("/a/b/canción.flac")).toBe(true);
    expect(isMediaPath("/a/b/notas.txt")).toBe(false);
    expect(isMediaPath("/a/b/.mkv")).toBe(false);
    expect(isSubtitlePath("/a/peli.es.srt")).toBe(true);
    expect(fileName("/Users/yo/Vídeos/clase 3.mp4")).toBe("clase 3.mp4");
  });

  it("filtra y ordena de forma natural", () => {
    const list = toPlaylist(["/s/Capítulo 10.mkv", "/s/leeme.txt", "/s/Capítulo 2.mkv", "/s/capítulo 1.mkv"]);
    expect(list.map((i) => i.name)).toEqual(["capítulo 1.mkv", "Capítulo 2.mkv", "Capítulo 10.mkv"]);
  });

  it("añade sin duplicar", () => {
    const a = toPlaylist(["/x/1.mp4", "/x/2.mp4"]);
    const merged = mergePlaylist(a, toPlaylist(["/x/2.mp4", "/x/3.mp4"]));
    expect(merged.map((i) => i.path)).toEqual(["/x/1.mp4", "/x/2.mp4", "/x/3.mp4"]);
  });

  it("navega siguiente/anterior sin salirse", () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBeNull();
    expect(stepIndex(0, 3, -1)).toBeNull();
  });
});
