import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.13";
import { validateReading } from "./validate.ts";

const photo = {
  date: "2026-11-04", time: "08:33", subtotal: 95.7, sighter: false,
  shots: [
    { n: 11, dir: "↘", score: 9.8 }, { n: 12, dir: "↓", score: 10.6 }, { n: 13, dir: "↖", score: 10.3 },
    { n: 14, dir: "→", score: 8.4 }, { n: 15, dir: "↙", score: 9.6 }, { n: 16, dir: "↗", score: 10.2 },
    { n: 17, dir: "↗", score: 8.5 }, { n: 18, dir: "↗", score: 8.9 }, { n: 19, dir: "↙", score: 9.7 },
    { n: 20, dir: "↗", score: 9.7 },
  ],
};

Deno.test("real photo reply", () => {
  const r = validateReading(photo);
  assertEquals(r.shots.length, 10);
  assertEquals(r.shots[0], { n: 11, s: 9.8, d: "↘" });
  assertEquals(r.subtotal, 95.7);
  assertEquals(r.date, "2026-11-04");
  assertEquals(r.time, "08:33");
  assertEquals(r.sighter, false);
});

Deno.test("subtotal string with suffix", () => {
  assertEquals(validateReading({ ...photo, subtotal: "95.7-3*" }).subtotal, 95.7);
});

Deno.test("duplicate shot keeps last", () => {
  const r = validateReading({ ...photo, shots: [{ n: 12, dir: "↓", score: 10.6 }, { n: 12, dir: "↓", score: 10.1 }] });
  assertEquals(r.shots, [{ n: 12, s: 10.1, d: "↓" }]);
});

Deno.test("out of range, unknown dir, bad date", () => {
  const r = validateReading({ ...photo, date: "2026-02-30", shots: [{ n: 1, dir: "NE", score: 9.1 }, { n: 2, dir: "↑", score: 11.2 }, { n: 0, dir: "↑", score: 9 }] });
  assertEquals(r.shots, [{ n: 1, s: 9.1, d: "" }]);
  assertEquals(r.date, "");
});

Deno.test("no shots is unreadable", () => {
  assertThrows(() => validateReading({ shots: [] }), Error, "unreadable");
  assertThrows(() => validateReading("garbage"), Error, "unreadable");
});
