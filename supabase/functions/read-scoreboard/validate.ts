// Trust boundary: the model's JSON is untrusted. Keep only values the app can store.
export type Shot = { n: number; s: number; d: string };
export type Reading = { date: string; time: string | null; subtotal: number | null; sighter: boolean; shots: Shot[] };

const DIRS = ["↖", "↑", "↗", "←", "→", "↙", "↓", "↘"];

function realDate(v: unknown): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : "";
}

function leadingNumber(v: unknown): number | null {
  const m = String(v ?? "").match(/^\s*(\d{1,4}(?:\.\d)?)/);
  return m ? +m[1] : null;
}

export function validateReading(raw: unknown): Reading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const byN = new Map<number, Shot>();
  for (const x of Array.isArray(r.shots) ? r.shots : []) {
    const n = Number(x?.n), s = Number(x?.score);
    if (!Number.isInteger(n) || n < 1 || n > 200 || !isFinite(s) || s < 0 || s > 10.9) continue;
    byN.delete(n); // later duplicate wins
    byN.set(n, { n, s: Math.round(s * 10) / 10, d: DIRS.includes(x?.dir) ? x.dir : "" });
  }
  const shots = [...byN.values()].sort((a, b) => a.n - b.n);
  if (!shots.length) throw new Error("unreadable");
  const t = String(r.time ?? "").match(/^(\d{1,2}):(\d{2})/);
  return {
    date: realDate(r.date),
    time: t && +t[1] < 24 && +t[2] < 60 ? t[1].padStart(2, "0") + ":" + t[2] : null,
    subtotal: typeof r.subtotal === "number" ? Math.round(r.subtotal * 10) / 10 : leadingNumber(r.subtotal),
    sighter: r.sighter === true,
    shots,
  };
}
