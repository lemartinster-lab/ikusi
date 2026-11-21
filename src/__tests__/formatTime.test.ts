import { formatDelay, formatTime } from "../lib/formatTime";

describe("formatTime", () => {
  it("usa m:ss por debajo de una hora", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(5.9)).toBe("0:05");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("usa h:mm:ss a partir de una hora", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(7265.3)).toBe("2:01:05");
  });

  it("devuelve 0:00 para valores no válidos", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(null)).toBe("0:00");
  });
});

describe("formatDelay", () => {
  it("muestra signo y coma decimal", () => {
    expect(formatDelay(0.3)).toBe("+0,30 s");
    expect(formatDelay(-1)).toBe("−1,00 s");
    expect(formatDelay(0)).toBe("0,00 s");
  });
});
