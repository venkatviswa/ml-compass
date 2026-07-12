// report.mjs — renders golden-test outcomes as a table (HTML + Markdown) with source links.
// Run: node report.mjs   →   writes test-report.html and test-report.md
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
// Write into docs/ regardless of the cwd the script is run from — writing to cwd once
// left a stale docs/test-report while fresh copies piled up at the repo root.
const DOCS = fileURLToPath(new URL("../docs/", import.meta.url));
import { recommend, sectionText } from "./rules.mjs";
import { DATASETS } from "./fixtures.mjs";

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return "source"; } };

const rows = DATASETS.map((d, idx) => {
  const rec = recommend(d.facts);
  const ids = [...new Set(d.expect.map((e) => e[0]))];
  const expected = d.expect.map((e) => e[1]).join(" · ");
  const actual = ids.map((id) => {
    const s = rec.sections.find((x) => x.id === id);
    return s ? `${id}: ${s.decision}` : `${id}: (none)`;
  }).join(" | ");
  let k = 0;
  d.expect.forEach(([id, n]) => { if (sectionText(rec, id).toLowerCase().includes(n.toLowerCase())) k++; });
  return {
    sno: idx + 1,
    dataset: d.name.split("—")[0].trim(),
    note: d.name.includes("—") ? d.name.split("—")[1].trim() : "",
    source: d.source || "",
    expected, actual, ok: k === d.expect.length, score: `${k}/${d.expect.length}`,
  };
});
const passCount = rows.filter((r) => r.ok).length;
const totalAssertions = rows.reduce((a, r) => a + Number(r.score.split("/")[1]), 0);

/* ---- markdown ---- */
let md = "| S.No | Dataset | Source | Expected (best-practice signals) | Actual (engine decisions) | Comment |\n";
md += "|---|---|---|---|---|---|\n";
rows.forEach((r) => {
  md += `| ${r.sno} | [${r.dataset}](${r.source}) | [${host(r.source)} ↗](${r.source}) | ${r.expected} | ${r.actual.replace(/\|/g, "/")} | ${r.ok ? "PASS" : "FAIL"} ${r.score} — ${r.note} |\n`;
});
md += `\n**${passCount}/${rows.length} datasets passed all assertions (${totalAssertions} fixture assertions; \`npm test\` adds unit checks for the profiler, question helpers and explainer guard).**\n`;
writeFileSync(DOCS + "test-report.md", md);

/* ---- html ---- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const trs = rows.map((r) => `
  <tr>
    <td class="sno">${r.sno}</td>
    <td class="ds"><a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.dataset)}</a><div class="note">${esc(r.note)}</div></td>
    <td class="src"><a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(host(r.source))} ↗</a></td>
    <td class="exp">${esc(r.expected)}</td>
    <td class="act">${esc(r.actual)}</td>
    <td class="res"><span class="badge ${r.ok ? "pass" : "fail"}">${r.ok ? "PASS" : "FAIL"} ${r.score}</span></td>
  </tr>`).join("");

const htmlDoc = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>ML Compass — Test Report</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--ink:#15202b;--soft:#445566;--paper:#fbfaf7;--panel:#fff;--line:#e3e1da;--sup:#1f6feb;--good:#1d7a3a;--goodbg:#e3f6e8;--bad:#b23b3b;--badbg:#fbe6e6;}
  *{box-sizing:border-box;} body{margin:0;background:var(--paper);color:var(--ink);font-family:'Inter',system-ui,sans-serif;}
  .wrap{max-width:1200px;margin:0 auto;padding:32px 20px 70px;}
  h1{font-family:'Space Grotesk',sans-serif;font-size:30px;margin:0 0 4px;letter-spacing:-.02em;}
  .sub{color:var(--soft);font-size:14px;margin:0 0 6px;max-width:80ch;}
  .summary{display:inline-block;margin:14px 0 22px;padding:8px 16px;border-radius:100px;background:var(--goodbg);color:var(--good);font-family:'JetBrains Mono',monospace;font-weight:600;font-size:14px;}
  table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:13px;}
  th{font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--soft);text-align:left;padding:12px 14px;background:#f6f5f1;border-bottom:1px solid var(--line);}
  td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top;}
  tr:last-child td{border-bottom:none;}
  a{color:var(--sup);text-decoration:none;} a:hover{text-decoration:underline;}
  .sno{font-family:'JetBrains Mono',monospace;color:var(--soft);width:38px;}
  .ds{font-weight:600;min-width:120px;} .ds .note{font-weight:400;font-size:11.5px;color:var(--soft);margin-top:3px;font-style:italic;}
  .src{font-family:'JetBrains Mono',monospace;font-size:11px;white-space:nowrap;}
  .exp{min-width:180px;} .act{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--soft);min-width:280px;line-height:1.5;}
  .res{white-space:nowrap;}
  .badge{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;}
  .badge.pass{background:var(--goodbg);color:var(--good);} .badge.fail{background:var(--badbg);color:var(--bad);}
  .foot{margin-top:18px;color:var(--soft);font-size:12.5px;}
</style></head><body><div class="wrap">
  <h1>ML Compass — Test Report</h1>
  <p class="sub">Golden tests: engine decisions vs best practice across 21 famous datasets. Assertions check decisions (metric, PCA, leakage, validation), not prose — this report covers the dataset fixtures; the runner (npm test) additionally carries unit checks for the profiler heuristics, question/framing helpers, and the explainer faithfulness guard. Every dataset name and Source link opens the original dataset page.</p>
  <div class="summary">✓ ${passCount}/${rows.length} datasets passed · ${totalAssertions} assertions</div>
  <table>
    <thead><tr><th>S.No</th><th>Dataset</th><th>Source</th><th>Expected</th><th>Actual (engine decisions)</th><th>Comment</th></tr></thead>
    <tbody>${trs}</tbody>
  </table>
  <p class="foot">Generated by report.mjs from the same fixtures the test runner uses. Source URLs live in fixtures.mjs.</p>
</div></body></html>`;
writeFileSync(DOCS + "test-report.html", htmlDoc);
console.log(`${passCount}/${rows.length} datasets · ${totalAssertions} fixture assertions · wrote docs/test-report.{md,html}`);
// Exit non-zero on any dataset failure so CI can gate on `node report.mjs` too — not just rules.test.mjs.
process.exit(passCount === rows.length ? 0 : 1);
