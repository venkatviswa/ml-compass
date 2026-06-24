// rules.mjs — the deterministic ML Compass advisor engine. Pure logic, no React.
// Single source of truth: the UI and the tests both import recommend().

import { SMALL_N, HIGH_CARD } from "./profiler.mjs";

export const LEAKY_RE = /total|final|outcome|result|paid|settle|tip|duration|dropoff_time|completed/i;

// shared classification-metric rule (used by tabular + text branches)
function clfMetrics(add, task, answers) {
  const imb = task.imbalance !== undefined && task.imbalance < 0.2;
  add("metrics", "Evaluation metrics",
    imb ? "PR-AUC (primary) · F1 · recall at fixed precision — avoid accuracy"
        : "F1 / ROC-AUC · per-class precision & recall",
    imb ? `Minority class is ${(task.imbalance * 100).toFixed(1)}% — accuracy would look great while missing it.`
        : "Reasonably balanced classes; standard classification metrics apply.",
    answers.errorCost === "fn" ? "False negatives cost more → weight recall, tune the threshold."
      : answers.errorCost === "fp" ? "False positives cost more → weight precision, tune the threshold." : null,
    imb ? "amber" : "sup");
}
function calibrationAndFairness(add, isClf, answers) {
  if (isClf && answers.needsProbs)
    add("calibration", "Probability calibration", "Required — reliability curve + Platt/isotonic",
      "Outputs are used as scores, so the probability itself must be trustworthy.", "Check Brier score alongside the curve.");
  if (answers.regulated)
    add("fairness", "Subgroup evaluation", "Required — compare metrics across subgroups",
      "High-stakes / regulated: overall averages can hide subgroup failures (age, sex, geography — where permitted).",
      "Prefer interpretable models or SHAP-explained trees; document everything.", "amber");
}

// facts = { modality, task, prof, answers, target, excludedCols }
//   modality: 'tabular' | 'text' | 'image'   (resolved after user confirmation)
//   task: null (unsupervised) | { kind:'classification'|'regression'|'ordinal', targetType, nClasses?, imbalance? }
export function recommend(facts) {
  const out = { sections: [] };
  const add = (id, title, decision, reason, caveat = null, tone = "sup") =>
    out.sections.push({ id, title, decision, reason, caveat, tone });
  const { modality = "tabular", task, prof, answers = {}, target, excludedCols = [] } = facts;

  /* ---------------- unsupervised ---------------- */
  if (task === null) {
    const m = {
      cluster: ["Unsupervised → Clustering", "No target column; goal is grouping similar records.",
        "KMeans for round clusters; DBSCAN/HDBSCAN for irregular shapes or noise; GMM for soft membership; hierarchical clustering (dendrogram) for small data with nested structure and no preset K. Scale first."],
      reduce: ["Unsupervised → Dimensionality reduction", "No target; goal is compressing or visualizing the space.",
        "PCA for linear compression; UMAP/t-SNE for 2D/3D visualization only."],
      anomaly: ["Unsupervised → Anomaly detection", "No target; goal is surfacing rare rows.",
        "Isolation Forest is the tabular default; One-Class SVM for small data; autoencoders for large/complex data."],
    }[answers.unsupGoal] || ["Unsupervised", "No target column selected.", null];
    add("task", "Detected task", m[0], m[1], m[2], "uns");
    return out;
  }

  const kind = task.kind;                 // classification | regression | ordinal
  const isClf = kind === "classification";
  const regLike = kind === "regression" || kind === "ordinal";

  /* ---------------- IMAGE branch ---------------- */
  if (modality === "image") {
    add("task", "Detected task", `Image ${isClf ? "classification" : "regression"}`,
      "Image / pixel data — spatial structure matters, so this is not a tabular problem.", null, "sup");
    add("baseline", "Baseline ladder", "Logistic / small CNN on flattened pixels",
      "A quick floor before fine-tuning a large model.");
    add("models", "Model families", "Transfer learning from a pretrained CNN → fine-tune (or a vision transformer)",
      "Convolutional layers learn spatial features that classic models on raw pixels miss.",
      "Classic ML on flattened pixels is only a sanity check, not the destination.");
    add("fe", "Feature work", "Data augmentation (flips, crops, normalization) instead of hand-built columns",
      "For images, augmentation replaces tabular feature engineering.");
    add("pca", "PCA decision", "Not used as preprocessing",
      "Conv layers learn the representation; PCA on raw pixels rarely helps.", null, "neu");
    add("metrics", "Evaluation metrics", isClf ? "Accuracy / macro-F1 · top-k" : "MAE / RMSE",
      "Standard image metrics; watch class balance for classification.");
    add("validation", "Validation strategy", "Hold-out or k-fold with no image/subject overlap across splits",
      "Make sure the same image or source isn't in both train and test.", null, "sup");
    add("leakage", "Leakage check", "1 flag", "Ensure no duplicate or same-source images span train and test.", null, "amber");
    calibrationAndFairness(add, isClf, answers);
    return out;
  }

  /* ---------------- TEXT branch ---------------- */
  if (modality === "text") {
    add("task", "Detected task", `Text ${isClf ? "classification" : "regression"}`,
      "A free-text feature drives this — not a tabular problem.", null, "sup");
    add("baseline", "Baseline ladder",
      isClf ? "DummyClassifier → TF-IDF + Logistic Regression / Multinomial Naive Bayes" : "DummyRegressor → TF-IDF + linear model",
      "Fast, strong text baselines; beat these before reaching for transformers.");
    add("models", "Model families", "TF-IDF + linear / Naive Bayes (a linear SVM is strong on small, high-dimensional text) → embeddings or a fine-tuned transformer only if the baseline falls short",
      "Transformers help, but a cheap baseline must set the bar first.");
    add("fe", "Feature work", "TF-IDF / counts, n-grams, length & keyword flags; embeddings later",
      "Text features replace column engineering.");
    add("pca", "Dimensionality", "TruncatedSVD, not PCA",
      "TF-IDF is sparse and high-dimensional; PCA assumes dense, centered data.", null, "neu");
    if (isClf) clfMetrics(add, task, answers);
    else add("metrics", "Evaluation metrics", "MAE / RMSE", "Regression on text targets — report errors in target units.");
    add("validation", "Validation strategy", isClf ? "Stratified k-fold cross-validation" : "k-fold cross-validation",
      "Fit the vectorizer on the training fold only.", "De-duplicate near-identical documents so they don't span splits.", "sup");
    add("leakage", "Leakage check", "1 flag",
      "Fit the vectorizer/encoder inside CV folds; remove duplicate documents across train and test.", null, "amber");
    calibrationAndFairness(add, isClf, answers);
    return out;
  }

  /* ---------------- TABULAR branch ---------------- */
  const smallN = prof.nRows && prof.nRows < SMALL_N;

  add("task", "Detected task",
    regLike ? `Supervised ${kind === "ordinal" ? "ordinal regression" : "regression"}`
            : `Supervised classification (${task.nClasses === 2 ? "binary" : "multiclass"}, ${task.nClasses} classes)`,
    regLike ? (kind === "ordinal" ? "A small set of ordered numeric values — an ordinal target."
                                  : "A labeled continuous numeric target → regression.")
            : "A labeled categorical target → classification.",
    kind === "ordinal" ? "Order carries meaning: pure classification throws it away, pure regression ignores the class boundaries." : null, "sup");

  add("baseline", "Baseline ladder",
    regLike ? (kind === "ordinal" ? "DummyRegressor (mean) → Linear / ordinal logistic" : "DummyRegressor (mean) → Linear Regression")
            : "DummyClassifier (majority class) → Logistic Regression",
    "Clear the naive floor first, then a simple model. If an ensemble can't beat these by a real margin, the framing or data is the problem.");

  const usableCols = prof.cols.filter((c) => c.name !== target && !excludedCols.includes(c.name) && !c.idLike);
  const highCard = usableCols.filter((c) => c.dtype === "categorical" && !c.idLike && c.cardinality > HIGH_CARD).map((c) => c.name);
  let famCaveat = null;
  if (highCard.length) famCaveat = `High-cardinality categoricals (${highCard.join(", ")}): CatBoost handles them natively, otherwise leakage-safe target encoding fit inside CV folds.`;
  if (answers.interpretability === "must") famCaveat = (famCaveat ? famCaveat + " " : "") + "Interpretability required: keep the linear model in the comparison and explain trees with SHAP.";

  if (smallN) {
    add("models", "Model families",
      "Simple model + cross-validation first; add a single Random Forest only if CV shows a real gain",
      `Small dataset (~${prof.nRows} rows): complex models overfit and CV estimates are noisy — favour simple, well-regularized models.`,
      famCaveat || "Skip heavy boosting until a regularized baseline justifies the complexity.");
  } else {
    add("models", "Model families",
      highCard.length ? "Random Forest → CatBoost / LightGBM" : "Random Forest (bagging) → then LightGBM / XGBoost (boosting)",
      "Tabular data: bagging is the robust low-tuning default; boosting chases accuracy once a fair baseline exists.",
      famCaveat);
  }

  if (isClf) clfMetrics(add, task, answers);
  else add("metrics", "Evaluation metrics", "MAE / RMSE (in target units) · R²",
    "Report errors in the unit stakeholders care about, plus a business threshold.",
    kind === "ordinal" ? "Also report accuracy-within-1 and consider ordinal-aware models (e.g. ordered logistic)." : null);

  add("pca", "PCA decision", "Skip initially",
    "Recommended families are tree ensembles — they handle correlated features natively and PCA destroys feature importances.",
    "Keep PCA as a side experiment (wide one-hot block, 2-component scatter). Revisit if you switch to kNN/SVM/linear/clustering.", "neu");

  const dt = usableCols.filter((c) => c.dtype === "datetime").map((c) => c.name);
  const fe = [];
  if (dt.length) fe.push(`Datetime (${dt.join(", ")}): recency (days since), gaps between dates (tenure), day-of-week, is_weekend, cyclical sin/cos for any time-of-day.`);
  if (highCard.length) fe.push("High-card categoricals: frequency or target encoding fit inside CV folds.");
  fe.push("Low-card categoricals: one-hot. Numeric: ratios/differences where they make domain sense.");
  const missCols = usableCols.filter((c) => c.missingPct > 0).map((c) => c.name);
  if (missCols.length) fe.push(`Missingness indicators for ${missCols.slice(0, 3).join(", ")} if informative.`);
  add("fe", "Feature engineering plan", fe.join(" "),
    "Highest-leverage step for tabular ML — work by data type, then interactions and aggregates.");

  add("validation", "Validation strategy",
    answers.timeDependent ? "Time-based split / walk-forward validation"
      : smallN ? "Repeated stratified k-fold cross-validation"
      : isClf ? "Stratified k-fold cross-validation" : "k-fold cross-validation",
    answers.timeDependent ? "Patterns drift over time — shuffling would leak the future into training."
      : smallN ? "Few rows make a single split noisy — repeat CV for a stable estimate."
      : "No time dependency indicated; standard CV is honest.",
    answers.timeDependent ? "Lag/rolling features must use only past data." : null,
    answers.timeDependent ? "amber" : "sup");

  const suspects = prof.cols.filter((c) => LEAKY_RE.test(c.name) && c.name !== target && !excludedCols.includes(c.name)).map((c) => c.name);
  const idCols = prof.cols.filter((c) => c.idLike).map((c) => c.name);
  const warn = [];
  if (excludedCols.length) warn.push(`Excluded as unknown at prediction time: ${excludedCols.join(", ")}.`);
  if (suspects.length) warn.push(`Suspicious by name, still included: ${suspects.join(", ")} — confirm they exist at prediction time.`);
  if (idCols.length) warn.push(`ID-like columns (${idCols.join(", ")}): drop from features; check they don't encode the target.`);
  warn.push("Fit every imputer, scaler and encoder inside CV folds.");
  add("leakage", "Leakage check", warn.length > 1 ? `${warn.length} flags` : "1 flag", warn.join(" "), null, suspects.length ? "bad" : "amber");

  calibrationAndFairness(add, isClf, answers);
  return out;
}

export function sectionText(rec, id) {
  const s = rec.sections.find((x) => x.id === id);
  return s ? `${s.decision} || ${s.reason} || ${s.caveat || ""}` : "";
}
