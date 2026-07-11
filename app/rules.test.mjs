// rules.test.mjs — golden tests. Run: node rules.test.mjs
import { recommend, sectionText } from "./rules.mjs";
import { profile, makeSample } from "./profiler.mjs";
import { DATASETS } from "./fixtures.mjs";

let pass = 0, fail = 0; const failed = [];
console.log(`\n=== ML Compass · golden tests vs best practice (${DATASETS.length} datasets) ===\n`);

// Profiler unit checks — fixtures pass idLike explicitly, so the heuristic itself
// is exercised here against the built-in taxi sample (timestamps must not be ID-like).
{
  const p = profile(makeSample());
  const byName = Object.fromEntries(p.cols.map((c) => [c.name, c]));
  // Sentinel heuristic: a continuous column spiking at 0 must flag; a 0/1 flag column must not.
  const sRows = Array.from({ length: 50 }, (_, i) => ({
    glucose: i < 15 ? "0" : String(80 + i * 1.5),   // 30% zeros, 36 distinct values
    smoker: String(i % 2),                            // legitimate 0/1 flag
  }));
  const sProf = Object.fromEntries(profile(sRows).cols.map((c) => [c.name, c]));
  const checks = [
    ["pickup_datetime detected as datetime", byName.pickup_datetime?.dtype === "datetime"],
    ["pickup_datetime NOT flagged ID-like", byName.pickup_datetime?.idLike === false],
    ["trip_id flagged ID-like", byName.trip_id?.idLike === true],
    ["zero-heavy continuous column flagged as sentinel", sProf.glucose?.sentinel?.value === 0],
    ["0/1 flag column NOT flagged as sentinel", !sProf.smoker?.sentinel],
  ];
  console.log("• Profiler heuristics — built-in taxi sample");
  for (const [label, ok] of checks) {
    ok ? pass++ : (fail++, failed.push(`profiler :: ${label}`));
    console.log(`   ${ok ? "✓" : "✗"} ${label}`);
  }
  console.log("");
}

for (const d of DATASETS) {
  const rec = recommend(d.facts);
  const lines = d.expect.map(([id, needle]) => {
    const ok = sectionText(rec, id).toLowerCase().includes(needle.toLowerCase());
    ok ? pass++ : (fail++, failed.push(`${d.name} :: [${id}] “${needle}”`));
    return `   ${ok ? "✓" : "✗"} [${id}] expects “${needle}”`;
  });
  console.log(`• ${d.name}\n${lines.join("\n")}\n`);
}
console.log("=== summary ===");
console.log(`${DATASETS.length} datasets · ${pass} assertions passed, ${fail} failed`);
if (failed.length) { console.log("\nFAILURES:"); failed.forEach((f) => console.log("  ✗ " + f)); }
console.log("");
process.exit(fail ? 1 : 0);
