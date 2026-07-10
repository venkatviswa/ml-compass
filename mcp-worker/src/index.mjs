// mcp-worker/src/index.mjs — ML Compass as a REMOTE MCP server on Cloudflare Workers.
//
// Privacy by design: unlike the local stdio server (mcp/server.mjs), the remote tools
// accept only the COMPUTED dataset profile and task facts — never raw rows. Profile
// locally first (the web app or the stdio server), then bring the facts here.
// The engine is the same deterministic rules.mjs the web app ships — rules decide,
// no LLM anywhere in this worker.
//
// Endpoints:  /mcp  (streamable HTTP — modern clients)   /sse  (legacy SSE clients)

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recommend, questionKeys, resolveTask, QUESTION_INFO } from "../../app/rules.mjs";

/* ---------------- input schemas (profile-in, no raw data) ---------------- */

const COL = z.object({
  name: z.string(),
  dtype: z.enum(["numeric", "categorical", "datetime", "text"]),
  cardinality: z.number(),
  missingPct: z.number().optional(),
  idLike: z.boolean().optional(),
});
const PROFILE = z.object({
  nRows: z.number(),
  nCols: z.number().optional(),
  cols: z.array(COL),
  modalityHint: z.enum(["tabular", "text", "image"]).optional(),
}).describe("The computed dataset profile (from the ML Compass web app or local MCP server) — no raw rows.");
const TASK = z.object({
  kind: z.enum(["classification", "regression", "ordinal"]),
  targetType: z.string().optional(),
  nClasses: z.number().optional(),
  imbalance: z.number().optional().describe("Minority-class fraction, e.g. 0.05"),
  framingAmbiguous: z.boolean().optional(),
}).optional().describe("Target facts; omit for unsupervised data.");
const ANSWERS = z.object({
  modality: z.enum(["tabular", "text", "image"]).optional(),
  framing: z.enum(["regression", "classification", "ordinal"]).optional(),
  timeDependent: z.boolean().optional(),
  needsProbs: z.boolean().optional(),
  interpretability: z.enum(["must", "nice", "no"]).optional(),
  regulated: z.boolean().optional(),
  errorCost: z.enum(["fn", "fp", "eq"]).optional(),
  unsupGoal: z.enum(["cluster", "reduce", "anomaly"]).optional(),
}).optional().describe("Answers to the questions the data can't reveal (see list_questions).");

const asJson = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const normalizeProfile = (p) => ({
  nRows: p.nRows,
  nCols: p.nCols ?? p.cols.length,
  cols: p.cols.map((c) => ({ missingPct: 0, idLike: false, ...c })),
  modalityHint: p.modalityHint ?? "tabular",
});

/* ---------------- the agent ---------------- */

export class MLCompassMCP extends McpAgent {
  server = new McpServer({ name: "ml-compass", version: "1.0.0" });

  async init() {
    this.server.registerTool(
      "list_questions",
      {
        title: "List the questions the data can't answer",
        description:
          "Given a dataset profile and (optional) target facts, return the follow-up questions a " +
          "human must answer — time-dependence, error cost, interpretability, … — with allowed values. " +
          "Ask these before calling get_bearing. Omit task for unsupervised data.",
        inputSchema: { profile: PROFILE, task: TASK, answers: ANSWERS },
      },
      async ({ profile, task, answers = {} }) => {
        const prof = normalizeProfile(profile);
        const noTarget = !task;
        const resolved = noTarget ? null : resolveTask(task, answers);
        const keys = questionKeys(prof, resolved, noTarget);
        const out = {
          questions: keys.map((k) => ({ key: k, ...QUESTION_INFO[k], answered: answers[k] !== undefined })),
        };
        // The question set depends on framing: warn the agent so answers aren't silently skipped.
        if (resolved?.framingAmbiguous && answers.framing === undefined) {
          const extra = questionKeys(prof, { ...resolved, kind: "classification" }, false).filter((k) => !keys.includes(k));
          if (extra.length) out.note =
            `If framing is answered "classification", these questions ALSO apply: ${extra.join(", ")}. ` +
            "Re-call list_questions with your answers to get the final set before get_bearing.";
        }
        return asJson(out);
      }
    );

    this.server.registerTool(
      "get_bearing",
      {
        title: "Get the bearing (the recommendation)",
        description:
          "Run the deterministic ML Compass rules engine on a dataset profile and return the full " +
          "bearing: task, baselines, model families, evaluation metric, PCA call, feature-engineering " +
          "plan, validation strategy, leakage audit, and (when relevant) calibration/fairness — each as " +
          "decision + reason + caveat. Pass the human's answers from list_questions; list columns NOT " +
          "known at prediction time in excludedCols (the single most valuable leakage guard). " +
          "No raw data is accepted or needed — only the computed profile.",
        inputSchema: {
          profile: PROFILE,
          task: TASK,
          target: z.string().optional().describe("Target column name (must exist in profile.cols); omit for unsupervised."),
          answers: ANSWERS,
          excludedCols: z.array(z.string()).optional()
            .describe("Columns unknown at prediction time — excluded from features and flagged."),
        },
      },
      async ({ profile, task, target, answers = {}, excludedCols = [] }) => {
        const prof = normalizeProfile(profile);
        const noTarget = !task;
        const resolved = noTarget ? null : resolveTask(task, answers);
        const rec = recommend({
          modality: noTarget ? "tabular" : (answers.modality || "tabular"),
          task: resolved, prof, answers, target: target || "", excludedCols,
        });
        const out = {
          note: "Every decision below came from deterministic rules over the dataset profile and the answers — not from a language model. When summarizing for the user, quote each section's decision verbatim (do not substitute metrics or model names); only the reasons may be paraphrased.",
          sections: rec.sections,
        };
        const unanswered = questionKeys(prof, resolved, noTarget).filter((k) => answers[k] === undefined);
        if (unanswered.length) out.unansweredQuestions = {
          keys: unanswered,
          note: "These questions were relevant but unanswered — the bearing assumes defaults. Answer them (see list_questions) for a sharper bearing.",
        };
        return asJson(out);
      }
    );
  }
}

/* ---------------- routing ---------------- */

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/mcp/"))
      return MLCompassMCP.serve("/mcp").fetch(request, env, ctx);
    if (pathname === "/sse" || pathname.startsWith("/sse/"))
      return MLCompassMCP.serveSSE("/sse").fetch(request, env, ctx);
    return new Response(
      "ML Compass MCP server. Connect an MCP client to /mcp (streamable HTTP) or /sse (SSE).\n" +
      "Tools: list_questions, get_bearing. Profile-in only — no raw data is accepted.\n" +
      "Web app: https://ml-compass.pages.dev  ·  Repo: https://github.com/venkatviswa/ml-compass",
      { status: pathname === "/" ? 200 : 404, headers: { "Content-Type": "text/plain" } }
    );
  },
};
