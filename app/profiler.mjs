// profiler.mjs — business logic: dataset profiling, modality detection, sample data.
// Pure functions, no React. Imported by the UI and (optionally) by tests.

// Matches ISO dates (2024-01-31, optional time) and common slash dates (9/28/12,
// 12/31/2024). Slash dates need two separators so plain fractions/ratios don't match.
export const DATE_RE = /^(\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?|\d{1,2}\/\d{1,2}\/\d{2,4})/;

// thresholds live here so they're easy to tune / mirror in the Python twin
export const SMALL_N = 500;          // below this, prefer simple models + CV
export const HIGH_CARD = 30;         // categorical levels above this = high cardinality
export const ORDINAL_MAX = 15;       // numeric target with <= this many values is framing-ambiguous

/* ---------- synthetic NYC taxi sample ---------- */
export function makeSample() {
  const rows = [];
  const zones = ["Midtown", "JFK", "LGA", "SoHo", "Harlem", "UES", "UWS", "FiDi", "Williamsburg", "Astoria"];
  for (let i = 0; i < 400; i++) {
    const hour = Math.floor(Math.random() * 24);
    const dist = +(Math.random() * 12 + 0.4).toFixed(2);
    const pu = zones[Math.floor(Math.random() * zones.length)];
    const doz = zones[Math.floor(Math.random() * zones.length)];
    const airport = pu === "JFK" || doz === "JFK" || pu === "LGA" || doz === "LGA";
    const fare = +(3 + dist * 2.6 + (hour >= 16 && hour <= 19 ? 2.4 : 0) + (airport ? 5 : 0) + Math.random() * 3).toFixed(2);
    const tip = +(fare * (Math.random() * 0.25)).toFixed(2);
    rows.push({
      trip_id: "T" + String(100000 + i),
      pickup_datetime: `2024-01-${String(1 + (i % 28)).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:00`,
      pickup_zone: pu, dropoff_zone: doz,
      passenger_count: Math.random() < 0.04 ? "" : String(1 + Math.floor(Math.random() * 4)),
      trip_distance: String(dist),
      payment_type: Math.random() < 0.7 ? "card" : "cash",
      tip_amount: String(tip),
      total_amount: String(+(fare + tip).toFixed(2)),
      fare_amount: String(fare),
    });
  }
  return rows;
}

/* ---------- column + dataset profiling ---------- */
export function profile(rows) {
  const cols = Object.keys(rows[0] || {});
  const n = rows.length;
  const colInfo = cols.map((c) => {
    let missing = 0, numeric = 0, dateHits = 0, totalLen = 0, nonEmpty = 0;
    const uniq = new Set();
    for (const r of rows) {
      const v = r[c];
      if (v === "" || v === null || v === undefined) { missing++; continue; }
      nonEmpty++; uniq.add(String(v)); totalLen += String(v).length;
      // Strict numeric: parseFloat handles the leading numeric run; isFinite(v) coerces via Number(v)
      // and rejects trailing junk like "1.5abc", so both checks together mean "the whole value is a finite number".
      if (!isNaN(parseFloat(v)) && isFinite(v)) numeric++;
      if (DATE_RE.test(String(v))) dateHits++;
    }
    const card = uniq.size;
    let dtype = "categorical";
    if (nonEmpty && dateHits / nonEmpty > 0.85) dtype = "datetime";
    else if (nonEmpty && numeric / nonEmpty > 0.9) dtype = "numeric";
    else if (nonEmpty && totalLen / nonEmpty > 40) dtype = "text";
    // Timestamps are naturally near-unique but are features (hour, recency…), not keys —
    // so datetime columns are exempt from the uniqueness heuristic.
    const idLike = (card / Math.max(nonEmpty, 1) > 0.95 && n > 20 && dtype !== "numeric" && dtype !== "datetime")
      || (dtype === "numeric" && card / Math.max(nonEmpty, 1) > 0.98 && /id$|^id|_id/i.test(c));
    return { name: c, dtype, missingPct: +(100 * missing / n).toFixed(1), cardinality: card, idLike };
  });

  // modality hint — a *suggestion* the user confirms, never an automatic decision
  const numericCols = colInfo.filter((c) => c.dtype === "numeric");
  const textCols = colInfo.filter((c) => c.dtype === "text");
  let modalityHint = "tabular";
  if (textCols.length >= 1 && colInfo.length - textCols.length <= 2) modalityHint = "text";
  else if (numericCols.length >= 50 && numericCols.every((c) => c.cardinality <= 256)) modalityHint = "image";

  return { nRows: n, nCols: cols.length, cols: colInfo, modalityHint };
}

/* ---------- target analysis (with framing ambiguity) ---------- */
export function targetFacts(rows, prof, target) {
  const info = prof.cols.find((c) => c.name === target);
  if (!info) return null;
  const vals = rows.map((r) => r[target]).filter((v) => v !== "" && v != null);
  const counts = {};
  vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  const sorted = Object.values(counts).sort((a, b) => a - b);
  const nClasses = Object.keys(counts).length;
  const imbalance = vals.length ? +(sorted[0] / vals.length).toFixed(3) : undefined;

  if (info.dtype === "numeric") {
    if (info.cardinality > ORDINAL_MAX) return { kind: "regression", targetType: "continuous" };
    // numeric but few distinct values → regression vs classification vs ordinal is a judgment call
    return { kind: "regression", targetType: "ordinal", framingAmbiguous: true, nClasses, imbalance };
  }
  return { kind: "classification", targetType: nClasses === 2 ? "binary" : "multiclass", nClasses, imbalance };
}
