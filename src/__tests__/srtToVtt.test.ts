import { srtToVtt } from "../lib/srtToVtt";

describe("srtToVtt", () => {
  it("convierte tiempos y conserva el texto multilínea", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,500\r\nKaixo!\r\nZer moduz?\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\n¿Qué tal?\r\n";
    expect(srtToVtt(srt)).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nKaixo!\nZer moduz?\n\n00:01:02.250 --> 00:01:04.000\n¿Qué tal?\n",
    );
  });

  it("quita el BOM y normaliza horas y milisegundos cortos", () => {
    const vtt = srtToVtt("﻿1\n0:0:5,5 --> 0:0:7,25\nHola\n");
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:05.500 --> 00:00:07.250");
  });

  it("descarta bloques sin tiempos o sin texto", () => {
    const srt = "basura\n\n1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nVálido\n";
    const vtt = srtToVtt(srt);
    expect(vtt.match(/-->/g)).toHaveLength(1);
    expect(vtt).toContain("Válido");
  });

  it("elimina etiquetas {\\an8} y flechas dentro del texto", () => {
    const vtt = srtToVtt("1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Arriba --> abajo\n");
    expect(vtt).toContain("Arriba → abajo");
    expect(vtt).not.toContain("{\\an8}");
  });

  it("ignora las coordenadas de posición de SRT", () => {
    const vtt = srtToVtt("1\n00:00:01,000 --> 00:00:02,000 X1:100 X2:200\nTexto\n");
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.000\n");
  });
});
