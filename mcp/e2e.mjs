// mcp/e2e.mjs — end-to-end test: drives mcp/server.mjs over real JSON-RPC stdio.
// Run: npm run test:mcp
import { spawn } from "node:child_process";

const child = spawn("node", ["mcp/server.mjs"], { cwd: new URL("..", import.meta.url).pathname, stdio: ["pipe", "pipe", "inherit"] });
let buf = ""; const pending = new Map(); let nextId = 1;
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
const call = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); send({ jsonrpc: "2.0", id, method, params }); });

// CSV: tiny taxi-like sample with near-unique timestamps and leak columns
const rows = ["trip_id,pickup_datetime,pickup_zone,trip_distance,tip_amount,total_amount,fare_amount"];
for (let i = 0; i < 60; i++) rows.push(`T${1000+i},2024-01-${String(1+(i%28)).padStart(2,"0")} ${String(i%24).padStart(2,"0")}:1${i%6}:00,Z${i%5},${(1+i%12).toFixed(1)},${(i%5).toFixed(2)},${(10+i%20).toFixed(2)},${(8+i%15).toFixed(2)}`);
const csv = rows.join("\n");

const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
console.log("1 initialize:", init.result.serverInfo.name, init.result.serverInfo.version);
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const tools = await call("tools/list", {});
console.log("2 tools:", tools.result.tools.map((t) => t.name).join(", "));

const prof = await call("tools/call", { name: "profile_dataset", arguments: { csv } });
const profData = JSON.parse(prof.result.content[0].text);
const dt = profData.profile.cols.find((c) => c.name === "pickup_datetime");
console.log("3 profile: nRows", profData.profile.nRows, "| pickup_datetime dtype", dt.dtype, "idLike", dt.idLike);

const q = await call("tools/call", { name: "list_questions", arguments: { csv, target: "fare_amount" } });
const qData = JSON.parse(q.result.content[0].text);
console.log("4 questions:", qData.questions.map((x) => x.key).join(", "), "| task kind:", qData.task.kind);

const b = await call("tools/call", { name: "get_bearing", arguments: { csv, target: "fare_amount",
  answers: { timeDependent: true, interpretability: "nice", regulated: false },
  excludedCols: ["tip_amount", "total_amount"] } });
const bData = JSON.parse(b.result.content[0].text);
console.log("5 bearing sections:", bData.sections.map((s) => s.id).join(", "));
console.log("   validation:", bData.sections.find((s) => s.id === "validation").decision);
console.log("   fe has Datetime:", bData.sections.find((s) => s.id === "fe").decision.includes("Datetime"));
console.log("   leakage:", bData.sections.find((s) => s.id === "leakage").reason.slice(0, 90) + "…");

// unsupervised path
const u = await call("tools/call", { name: "get_bearing", arguments: { csv, answers: { unsupGoal: "cluster" } } });
console.log("6 unsupervised:", JSON.parse(u.result.content[0].text).sections[0].decision);

// error path
const err = await call("tools/call", { name: "get_bearing", arguments: { csv, target: "nope" } });
console.log("7 bad target -> isError:", err.result.isError === true);

// framing-dependent questions: ambiguous target with no framing answer must WARN that
// classification adds needsProbs/errorCost (the gap a live agent run exposed)
const q2 = await call("tools/call", { name: "list_questions", arguments: { csv, target: "fare_amount" } });
const q2d = JSON.parse(q2.result.content[0].text);
console.log("8 framing note present:", /needsProbs/.test(q2d.note || ""));

// and a bearing with framing answered but needsProbs/errorCost skipped must surface them
const b2 = await call("tools/call", { name: "get_bearing", arguments: { csv, target: "fare_amount",
  answers: { framing: "classification", timeDependent: false, interpretability: "nice", regulated: false } } });
const b2d = JSON.parse(b2.result.content[0].text);
console.log("9 unanswered surfaced:", JSON.stringify(b2d.unansweredQuestions?.keys));
console.log("10 resolved targetType:", b2d.task.targetType);

// small-n PCA reason must match the small-n model advice (not claim "tree ensembles")
const pca = b2d.sections.find((s) => s.id === "pca");
console.log("11 small-n PCA reason:", /simple and well-regularized/.test(pca.reason));

child.kill();
