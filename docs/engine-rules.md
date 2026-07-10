# How ML Compass Decides — The Engine's Rules

> The *bearing* you see is produced by a **deterministic rules engine**
> (`app/rules.mjs`) — **not** a language model. This document is the human-readable
> specification of those rules: every decision, the condition that triggers it, and
> why. If a recommendation ever surprises you, the reason is in here.
>
> The optional LLM only **rewords** these outputs; it can never change a decision.

---

## 1. What goes in

The engine receives two kinds of input — and the split is deliberate.

**Computed from the dataset (objective — never asked)** — produced by `profile()` / `targetFacts()`:

| Fact | Example |
|------|---------|
| `nRows`, `nCols` | 30801 × 15 |
| per-column `dtype` | `numeric` · `categorical` · `datetime` · `text` |
| `cardinality` | distinct values per column |
| `missingPct` | % missing per column |
| `idLike` | near-unique key columns (drop from features); datetime columns are exempt — timestamps are near-unique by nature but are features, not keys |
| `modalityHint` | `tabular` · `text` · `image` (a suggestion you confirm) |
| target `kind` | `classification` · `regression` · `ordinal` |
| `imbalance` | minority-class fraction |

**Answered by you (~5 taps — only what the data can't reveal):**

`modality` (confirm) · `framing` (regression vs classification, when ambiguous) ·
`timeDependent` · `needsProbs` · `interpretability` · `regulated` · `errorCost` ·
`unsupGoal` (cluster / reduce / anomaly).

---

## 2. Thresholds

All tunable constants live in one place (`app/profiler.mjs`), so the behavior is easy to audit.

| Constant | Value | Meaning |
|----------|-------|---------|
| `SMALL_N` | **500** | below this many rows → the "small data" path (simpler models, repeated CV) |
| `HIGH_CARD` | **30** | a categorical with more levels than this → "high-cardinality" |
| `ORDINAL_MAX` | **15** | a *numeric* target with ≤ this many distinct values → **framing-ambiguous** (asks you) |
| imbalance cutoff | **0.20** | minority class < 20% → imbalanced-aware metrics |

---

## 3. Which branch runs

```
no target column ............ → Unsupervised
modality = image ............ → Image
modality = text ............. → Text
otherwise ................... → Tabular
```

---

## 4. The rules, section by section

Each section emits a **decision**, a **reason**, and sometimes a **caveat**.

### Task detection
| Condition | Decision |
|-----------|----------|
| numeric target, > `ORDINAL_MAX` distinct values | Supervised **regression** |
| numeric target, ≤ `ORDINAL_MAX` distinct values | **framing-ambiguous** → asks you (regression / classification / ordinal) |
| categorical target, 2 classes | Supervised **classification (binary)** |
| categorical target, > 2 classes | Supervised **classification (multiclass)** |
| ordinal (your choice) | regression that respects order; caveat that pure classification/regression each lose information |

### Baseline ladder *(always fit a naive floor first)*
| Task | Baseline |
|------|----------|
| classification | `DummyClassifier` (majority class) → **Logistic Regression** |
| regression | `DummyRegressor` (mean) → **Linear Regression** |
| ordinal | `DummyRegressor` → Linear / ordinal logistic |
| text | Dummy → **TF-IDF + Logistic Regression / Multinomial Naive Bayes** |
| image | Logistic / small CNN on flattened pixels |

> *Rationale: if an ensemble can't beat the naive floor by a real margin, the framing or data is the problem — not the model.*

### Model families
| Condition | Recommendation |
|-----------|----------------|
| tabular, normal size | **Random Forest** (bagging) → **LightGBM / XGBoost** (boosting) |
| tabular, **high-cardinality** present | Random Forest → **CatBoost / LightGBM** (CatBoost handles categories natively) |
| tabular, **small n** (< `SMALL_N`) | simple model + CV first; add a *single* Random Forest only if CV shows a real gain |
| text | TF-IDF + linear / Naive Bayes (a **linear SVM** is strong on small, high-dim text) → embeddings / fine-tuned **transformer** if the baseline falls short |
| image | **transfer learning** from a pretrained **CNN** → fine-tune (or a **Vision Transformer**) |

Caveats added when relevant:
- **High-card categoricals** → CatBoost native, else leakage-safe target encoding inside CV folds.
- **Interpretability required** → keep the linear model in the comparison and explain trees with SHAP.

### Evaluation metrics
| Condition | Metric |
|-----------|--------|
| classification, minority ≥ 20% | F1 / ROC-AUC · per-class precision & recall |
| classification, minority **< 20%** | **PR-AUC** (primary) · F1 · recall at fixed precision — *avoid accuracy* |
| regression | MAE / RMSE (in target units) · R² |
| image classification | Accuracy / macro-F1 · top-k |
| `errorCost = fn` | weight **recall**, tune the threshold |
| `errorCost = fp` | weight **precision**, tune the threshold |

### PCA decision
| Branch | Decision |
|--------|----------|
| tabular (tree ensembles) | **Skip initially** — trees handle correlated features; PCA destroys importances. Revisit only for kNN/SVM/linear/clustering. |
| text | **TruncatedSVD, not PCA** — TF-IDF is sparse/high-dim; PCA assumes dense, centered data. |
| image | Not used as preprocessing — conv layers learn the representation. |

### Feature engineering *(tabular)*
Built per data type from the profile:
- **Datetime** → recency (days since), gaps/tenure between dates, day-of-week, is_weekend, cyclical sin/cos.
- **High-card categoricals** → frequency / target encoding fit inside CV folds.
- **Low-card categoricals** → one-hot. **Numeric** → ratios / differences where they make domain sense.
- **Columns with missing values** → missingness indicators if informative.

### Validation strategy
| Condition | Strategy |
|-----------|----------|
| `timeDependent` | **Time-based split / walk-forward** (shuffling would leak the future) |
| small n, classification | **Repeated stratified** k-fold (one split is too noisy) |
| small n, regression | **Repeated** k-fold (stratification is a class-label concept) |
| classification | **Stratified** k-fold cross-validation |
| regression | k-fold cross-validation |

### Leakage check *(always present)*
Flags raised:
- **Excluded** columns you said wouldn't be known at prediction time.
- **Leak-suspect by name** (`total`, `final`, `outcome`, `paid`, …) still included — confirm they exist at prediction time.
- **ID-like** columns → drop from features; check they don't encode the target.
- Always: **fit every imputer, scaler and encoder inside CV folds.**

### Probability calibration & subgroup evaluation
- `needsProbs` (classification) → **calibration required** (reliability curve + Platt/isotonic; check Brier score).
- `regulated` → **subgroup evaluation required** (overall averages hide subgroup failures); prefer interpretable models / SHAP.

---

## 5. Algorithm coverage

How the engine's choices line up with a general practitioner field guide of 18 core
algorithms. The headline: every **Go-to** is used in the right place, every
**Baseline** is used as a baseline, and the **Niche/Superseded** ones are
*deliberately avoided* — exactly as a seasoned practitioner would.

| Algorithm | Field-guide verdict | In the engine? |
|-----------|--------------------|----------------|
| Linear / Logistic Regression | Baseline | ✅ baseline ladders |
| Naive Bayes | Baseline | ✅ text baseline |
| Random Forest | Go-to | ✅ tabular default |
| XGBoost / LightGBM | Go-to | ✅ tabular boosting |
| CatBoost | Go-to | ✅ high-cardinality path |
| K-Means | Go-to | ✅ clustering default |
| DBSCAN | Go-to | ✅ irregular-shape clustering |
| PCA | Go-to | ✅ PCA / dim-reduction |
| CNN | Go-to | ✅ image models |
| Transformer | Go-to | ✅ text/image, embeddings |
| Autoencoder | Niche | ✅ anomaly (large/complex) |
| **SVM** | Niche | ✅ text/high-dim mention + One-Class SVM for anomaly |
| **Hierarchical Clustering** | Niche | ✅ small-data / nested-structure clustering |
| Decision Tree (solo) | Niche | 🚫 *avoided on purpose* — guide says "rarely deployed solo" |
| KNN | Niche | 🚫 *avoided* — niche / teaching baseline |
| MLP (on tabular) | Niche | 🚫 *avoided* — boosting wins on tabular |
| RNN / LSTM | Superseded | 🚫 *avoided* — transformers preferred |

The engine also recommends a few practical algorithms **beyond** the 18-entry guide:
**Isolation Forest** & **One-Class SVM** (anomaly), **GMM** (soft clustering),
**TruncatedSVD** (sparse text), and **UMAP / t-SNE** (visualization).

---

## 6. Everything here is tested

These rules aren't aspirational — they're **regression-tested**. The golden suite
(`app/rules.test.mjs`, `app/fixtures.mjs`) encodes **21 famous datasets** and asserts
the engine's *decisions* (task, metric, PCA, validation, leakage) against best
practice — **77 assertions, 0 failures**. Change a rule and the suite tells you
immediately if it broke an established call.

```bash
node app/rules.test.mjs
```

> If a recommendation can't be tested, we don't trust it — and neither should you.
