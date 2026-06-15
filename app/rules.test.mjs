// rules.test.mjs — golden tests. Run: node rules.test.mjs
import { recommend, sectionText } from "./rules.mjs";
import { DATASETS } from "./fixtures.mjs";

let pass = 0, fail = 0; const failed = [];
console.log("\n=== ML Compass · golden tests vs best practice (20 datasets) ===\n");
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
