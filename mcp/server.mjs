#!/usr/bin/env node
// mcp/server.mjs — headless ML Compass as a LOCAL MCP server (stdio transport).
//
// The exact deterministic engine the web app uses (app/rules.mjs, app/profiler.mjs)
// exposed as tools for AI agents. Rules decide — there is no LLM anywhere in this
// server, and your data never leaves the machine: CSVs are read from the local disk.
//
// Run:      node mcp/server.mjs          (or: npm run mcp)
// Claude Desktop / Claude Code config:
//   { "mcpServers": { "ml-compass": { "command": "node",
//       "args": ["/path/to/ml-compass/mcp/server.mjs"] } } }
//
// Typical agent flow: profile_dataset → list_questions → (ask the human) → get_bearing.

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Papa from "papaparse";
import { profile, targetFacts } from "../app/profiler.mjs";
import { recommend, questionKeys, resolveTask, QUESTION_INFO } from "../app/rules.mjs";

const server = new McpServer({ name: "ml-compass", version: "1.0.0" });

/* ---------------- shared input plumbing ---------------- */

const SOURCE_SHAPE = {
  csv: z.string().optional().describe("Raw CSV content (with a header row)."),
  path: z.string().optional().describe("Path to a local CSV file (alternative to csv)."),
};
const ANSWERS_SHAPE = z.object({
  modality: z.enum(["tabular", "text", "image"]).optional(),
  framing: z.enum(["regression", "classification", "ordinal"]).optional(),
  timeDependent: z.boolean().optional(),
  needsProbs: z.boolean().optional(),
  interpretability: z.enum(["must", "nice", "no"]).optional(),
  regulated: z.boolean().optional(),
  errorCost: z.enum(["fn", "fp", "eq"]).optional(),
  unsupGoal: z.enum(["cluster", "reduce", "anomaly"]).optional(),
}).optional().describe("Answers to the questions the data can't reveal (see list_questions).");

function loadRows({ csv, path }) {
  if (!csv && !path) throw new Error("Provide either `csv` (content) or `path` (local file).");
  const text = (csv ?? readFileSync(path, "utf8")).replace(/^﻿/, "");
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (!res.data?.length) throw new Error("No rows parsed — is the first line a header row?");
  return res.data;
}
const asJson = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const asError = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });

/* ---------------- tools ---------------- */

server.registerTool(
  "profile_dataset",
  {
    title: "Profile a dataset",
    description:
      "Compute the objective facts of a CSV dataset: per-column dtype (numeric/categorical/" +
      "datetime/text), cardinality, missing %, ID-like flags, and a modality hint. " +
      "This is deterministic profiling — no model involved. Start here.",
    inputSchema: SOURCE_SHAPE,
  },
  async (args) => {
    try {
      const rows = loadRows(args);
      return asJson({ profile: profile(rows) });
    } catch (e) { return asError(e); }
  }
);

server.registerTool(
  "list_questions",
  {
    title: "List the questions the data can't answer",
    description:
      "Given the dataset and an optional target column, return the follow-up questions a human " +
      "must answer (time-dependence, error cost, interpretability, …) with their allowed values. " +
      "Ask these before calling get_bearing; omit `target` for unsupervised data.",
    inputSchema: {
      ...SOURCE_SHAPE,
      target: z.string().optional().describe("Target column name; omit if there is no target."),
      answers: ANSWERS_SHAPE,
    },
  },
  async ({ target, answers = {}, ...src }) => {
    try {
      const rows = loadRows(src);
      const prof = profile(rows);
      const noTarget = !target;
      const task = noTarget ? null : resolveTask(targetFacts(rows, prof, target), answers);
      if (!noTarget && !task) throw new Error(`Target column "${target}" not found in the dataset.`);
      const keys = questionKeys(prof, task, noTarget);
      const out = {
        task,
        questions: keys.map((k) => ({ key: k, ...QUESTION_INFO[k], answered: answers[k] !== undefined })),
      };
      // The question set depends on framing: warn the agent so answers aren't silently skipped.
      if (task?.framingAmbiguous && answers.framing === undefined) {
        const extra = questionKeys(prof, { ...task, kind: "classification" }, false).filter((k) => !keys.includes(k));
        if (extra.length) out.note =
          `If framing is answered "classification", these questions ALSO apply: ${extra.join(", ")}. ` +
          "Re-call list_questions with your answers to get the final set before get_bearing.";
      }
      return asJson(out);
    } catch (e) { return asError(e); }
  }
);

server.registerTool(
  "get_bearing",
  {
    title: "Get the bearing (the recommendation)",
    description:
      "Run the deterministic rules engine and return the full bearing: task, baselines, model " +
      "families, evaluation metric, PCA call, feature-engineering plan, validation strategy, " +
      "leakage audit, and (when relevant) calibration/fairness — each as decision + reason + caveat. " +
      "Pass the human's answers from list_questions, and list any columns that would NOT be known " +
      "at prediction time in excludedCols (the single most valuable leakage guard).",
    inputSchema: {
      ...SOURCE_SHAPE,
      target: z.string().optional().describe("Target column name; omit for unsupervised."),
      answers: ANSWERS_SHAPE,
      excludedCols: z.array(z.string()).optional()
        .describe("Columns unknown at prediction time — excluded from features and flagged."),
    },
  },
  async ({ target, answers = {}, excludedCols = [], ...src }) => {
    try {
      const rows = loadRows(src);
      const prof = profile(rows);
      const noTarget = !target;
      const task = noTarget ? null : resolveTask(targetFacts(rows, prof, target), answers);
      if (!noTarget && !task) throw new Error(`Target column "${target}" not found in the dataset.`);
      const rec = recommend({
        modality: noTarget ? "tabular" : (answers.modality || "tabular"),
        task, prof, answers, target: target || "", excludedCols,
      });
      const out = {
        note: "Every decision below came from deterministic rules over the dataset profile and the answers — not from a language model. When summarizing for the user, quote each section's decision verbatim (do not substitute metrics or model names); only the reasons may be paraphrased.",
        task, sections: rec.sections,
      };
      // Surface any relevant-but-unanswered questions so defaults aren't assumed silently
      // (e.g. needsProbs/errorCost only become relevant once framing resolves to classification).
      const unanswered = questionKeys(prof, task, noTarget).filter((k) => answers[k] === undefined);
      if (unanswered.length) out.unansweredQuestions = {
        keys: unanswered,
        note: "These questions were relevant but unanswered — the bearing assumes defaults. Answer them (see list_questions) for a sharper bearing.",
      };
      return asJson(out);
    } catch (e) { return asError(e); }
  }
);

await server.connect(new StdioServerTransport());
