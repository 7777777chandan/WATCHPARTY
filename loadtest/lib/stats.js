/** Percentile helpers (nearest-rank). */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { count: 0, p50: null, p90: null, p95: null, p99: null, max: null, mean: null, min: null };
  const round = (x) => Math.round(x * 100) / 100;
  return {
    count: v.length,
    min: round(v[0]),
    p50: round(percentile(v, 50)),
    p90: round(percentile(v, 90)),
    p95: round(percentile(v, 95)),
    p99: round(percentile(v, 99)),
    max: round(v[v.length - 1]),
    mean: round(v.reduce((a, b) => a + b, 0) / v.length),
  };
}
