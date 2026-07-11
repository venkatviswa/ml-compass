// fixtures.mjs — dataset fixtures shared by the test runner and the report generator.

const col = (name, dtype, cardinality = 10, missingPct = 0, idLike = false, sentinel = null) =>
  ({ name, dtype, cardinality, missingPct, idLike, sentinel });
const prof = (cols, nRows) => ({ nRows, nCols: cols.length, cols });

const DATASETS = [
  /* ============ CORE 10 ============ */
  {
    name: "Titanic — binary classification, mild imbalance",
    source: "https://www.kaggle.com/c/titanic",
    facts: { target: "Survived", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.38 },
      prof: prof([col("PassengerId", "numeric", 891, 0, true), col("Pclass", "categorical", 3), col("Name", "text", 891), col("Sex", "categorical", 2), col("Age", "numeric", 88, 19.9), col("Ticket", "categorical", 681, 0, true), col("Fare", "numeric", 248), col("Cabin", "categorical", 147, 77.1, true), col("Embarked", "categorical", 3, 0.2)], 891),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "classification"], ["baseline", "Logistic Regression"], ["metrics", "F1"], ["pca", "Skip initially"], ["leakage", "PassengerId"]],
  },
  {
    name: "Iris — multiclass, balanced, tiny (small-n)",
    source: "https://archive.ics.uci.edu/dataset/53/iris",
    facts: { target: "species", task: { kind: "classification", targetType: "multiclass", nClasses: 3, imbalance: 0.333 },
      prof: prof([col("sepal_length", "numeric", 35), col("sepal_width", "numeric", 23), col("petal_length", "numeric", 43), col("petal_width", "numeric", 22)], 150),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "classification"], ["models", "cross-validation"], ["models", "Small dataset"], ["validation", "Repeated"]],
  },
  {
    name: "House Prices (Ames) — regression, high-card, missing",
    source: "https://www.kaggle.com/c/house-prices-advanced-regression-techniques",
    facts: { target: "SalePrice", task: { kind: "regression", targetType: "continuous" },
      prof: prof([col("Neighborhood", "categorical", 25), col("MSSubClass", "categorical", 15), col("GrLivArea", "numeric", 861), col("LotArea", "numeric", 1073), col("GarageType", "categorical", 6, 5.5), col("PoolQC", "categorical", 4, 99.5)], 1460),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "regression"], ["metrics", "RMSE"], ["pca", "Skip initially"], ["fe", "Missingness indicators"]],
  },
  {
    name: "Credit Card Fraud — extreme imbalance",
    source: "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud",
    facts: { target: "Class", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.0017 },
      prof: prof([...Array.from({ length: 28 }, (_, i) => col("V" + (i + 1), "numeric", 284807)), col("Time", "numeric", 124592), col("Amount", "numeric", 32767)], 284807),
      answers: { timeDependent: false, needsProbs: true, regulated: false, interpretability: "no", errorCost: "fn" }, excludedCols: [] },
    expect: [["metrics", "PR-AUC"], ["metrics", "avoid accuracy"], ["calibration", "Required"], ["metrics", "recall"], ["metrics", "class weights"], ["metrics", "break calibration"]],
  },
  {
    name: "Adult / Census Income — fairness-sensitive",
    source: "https://archive.ics.uci.edu/dataset/2/adult",
    facts: { target: "income", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.24 },
      prof: prof([col("age", "numeric", 73), col("workclass", "categorical", 9, 5.6), col("occupation", "categorical", 15, 5.7), col("native_country", "categorical", 42, 1.8), col("sex", "categorical", 2), col("race", "categorical", 5)], 48842),
      answers: { timeDependent: false, needsProbs: false, regulated: true, interpretability: "must", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "classification"], ["fairness", "subgroups"], ["models", "CatBoost"], ["models", "Interpretability required"], ["fairness", "monotonic constraints"], ["fairness", "EBMs"]],
  },
  {
    name: "Telco Customer Churn — probabilities matter",
    source: "https://www.kaggle.com/datasets/blastchar/telco-customer-churn",
    facts: { target: "Churn", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.27 },
      prof: prof([col("tenure", "numeric", 73), col("Contract", "categorical", 3), col("MonthlyCharges", "numeric", 1585), col("TotalCharges", "numeric", 6531, 0.2), col("PaymentMethod", "categorical", 4)], 7043),
      answers: { timeDependent: false, needsProbs: true, regulated: false, interpretability: "nice", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "classification"], ["calibration", "Required"], ["metrics", "recall"]],
  },
  {
    name: "Wine Quality — framing resolved to ordinal",
    source: "https://archive.ics.uci.edu/dataset/186/wine+quality",
    facts: { target: "quality", task: { kind: "ordinal", targetType: "ordinal", nClasses: 6, imbalance: 0.04 },
      prof: prof([col("alcohol", "numeric", 65), col("pH", "numeric", 89), col("citric_acid", "numeric", 80), col("sulphates", "numeric", 96)], 1599),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "ordinal"], ["metrics", "accuracy-within-1"], ["metrics", "Frank & Hall"], ["metrics", "mord"]],
  },
  {
    name: "NYC Taxi — regression, time-dependent, leakage",
    source: "https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page",
    facts: { target: "fare_amount", task: { kind: "regression", targetType: "continuous" },
      prof: prof([col("pickup_datetime", "datetime", 280), col("pickup_zone", "categorical", 40), col("dropoff_zone", "categorical", 40), col("trip_distance", "numeric", 900), col("tip_amount", "numeric", 700), col("total_amount", "numeric", 950)], 3000000),
      answers: { timeDependent: true, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: ["tip_amount", "total_amount"] },
    expect: [["task", "regression"], ["validation", "Time-based"], ["leakage", "Excluded as unknown at prediction time: tip_amount, total_amount"], ["fe", "Datetime"]],
  },
  {
    name: "MNIST — images",
    source: "https://www.kaggle.com/datasets/hojjatk/mnist-dataset",
    facts: { modality: "image", target: "label", task: { kind: "classification", targetType: "multiclass", nClasses: 10, imbalance: 0.09 },
      prof: prof(Array.from({ length: 50 }, (_, i) => col("pixel" + i, "numeric", 256)), 60000),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "no", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "Image classification"], ["models", "CNN"], ["fe", "augmentation"]],
  },
  {
    name: "SMS Spam — text, imbalanced",
    source: "https://archive.ics.uci.edu/dataset/228/sms+spam+collection",
    facts: { modality: "text", target: "label", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.13 },
      prof: prof([col("message", "text", 5169)], 5572),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "Text classification"], ["baseline", "Naive Bayes"], ["models", "TF-IDF"], ["pca", "TruncatedSVD"], ["metrics", "PR-AUC"]],
  },

  /* ============ EXTENDED 10 ============ */
  {
    name: "Pima Indians Diabetes — medical, moderate imbalance",
    source: "https://www.kaggle.com/datasets/uciml/pima-indians-diabetes-database",
    facts: { target: "Outcome", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.349 },
      prof: prof([col("Pregnancies", "numeric", 17), col("Glucose", "numeric", 136), col("BloodPressure", "numeric", 47), col("BMI", "numeric", 248), col("Age", "numeric", 52), col("Insulin", "numeric", 186, 0, false, { value: 0, pct: 48.7 })], 768),
      answers: { timeDependent: false, needsProbs: true, regulated: true, interpretability: "must", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "classification"], ["fairness", "subgroups"], ["metrics", "F1"], ["calibration", "Required"], ["fe", "Sentinel check"], ["fe", "missing values in disguise"]],
  },
  {
    name: "California Housing — clean regression",
    source: "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.fetch_california_housing.html",
    facts: { target: "MedHouseVal", task: { kind: "regression", targetType: "continuous" },
      prof: prof([col("MedInc", "numeric", 12928), col("HouseAge", "numeric", 52), col("AveRooms", "numeric", 19392), col("Latitude", "numeric", 862), col("Longitude", "numeric", 844)], 20640),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "regression"], ["metrics", "RMSE"], ["pca", "Skip initially"]],
  },
  {
    name: "Heart Disease (Cleveland) — medical, small-n",
    source: "https://archive.ics.uci.edu/dataset/45/heart+disease",
    facts: { target: "target", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.46 },
      prof: prof([col("age", "numeric", 41), col("sex", "categorical", 2), col("cp", "categorical", 4), col("chol", "numeric", 152), col("thalach", "numeric", 91)], 303),
      answers: { timeDependent: false, needsProbs: false, regulated: true, interpretability: "must", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "classification"], ["models", "Small dataset"], ["models", "cross-validation"], ["validation", "Repeated"], ["fairness", "subgroups"]],
  },
  {
    name: "Spaceship Titanic — modern, missing + IDs",
    source: "https://www.kaggle.com/c/spaceship-titanic",
    facts: { target: "Transported", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.50 },
      prof: prof([col("PassengerId", "categorical", 8693, 0, true), col("HomePlanet", "categorical", 3, 2.3), col("CryoSleep", "categorical", 2, 2.5), col("Cabin", "categorical", 6560, 2.3, true), col("Age", "numeric", 80, 2.1), col("RoomService", "numeric", 1273, 2.1), col("Name", "categorical", 8473, 2.3, true)], 8693),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "classification"], ["leakage", "ID-like"], ["fe", "Missingness indicators"]],
  },
  {
    name: "Breast Cancer Wisconsin — correlated numeric",
    source: "https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic",
    facts: { target: "diagnosis", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.373 },
      prof: prof([col("radius_mean", "numeric", 456), col("texture_mean", "numeric", 479), col("perimeter_mean", "numeric", 522), col("area_mean", "numeric", 539), col("concavity_mean", "numeric", 537)], 569),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "classification"], ["metrics", "F1"], ["pca", "Skip initially"]],
  },
  {
    name: "Bike Sharing Demand — time-dependent regression",
    source: "https://www.kaggle.com/c/bike-sharing-demand",
    facts: { target: "count", task: { kind: "regression", targetType: "continuous" },
      prof: prof([col("datetime", "datetime", 10886), col("season", "categorical", 4), col("weather", "categorical", 4), col("temp", "numeric", 49), col("humidity", "numeric", 89)], 17379),
      answers: { timeDependent: true, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "regression"], ["validation", "Time-based"], ["fe", "Datetime"]],
  },
  {
    name: "IMDB Reviews — text, balanced",
    source: "https://ai.stanford.edu/~amaas/data/sentiment/",
    facts: { modality: "text", target: "sentiment", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.50 },
      prof: prof([col("review", "text", 49582)], 50000),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "Text classification"], ["models", "TF-IDF"], ["metrics", "ROC-AUC"]],
  },
  {
    name: "CIFAR-10 — images",
    source: "https://www.cs.toronto.edu/~kriz/cifar.html",
    facts: { modality: "image", target: "label", task: { kind: "classification", targetType: "multiclass", nClasses: 10, imbalance: 0.10 },
      prof: prof(Array.from({ length: 60 }, (_, i) => col("px" + i, "numeric", 256)), 60000),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "no", errorCost: "eq" }, excludedCols: [] },
    expect: [["task", "Image classification"], ["models", "CNN"], ["fe", "augmentation"]],
  },
  {
    name: "Mall Customers — unsupervised clustering",
    source: "https://www.kaggle.com/datasets/vjchoudhary7/customer-segmentation-tutorial-in-python",
    facts: { target: "", task: null,
      prof: prof([col("Age", "numeric", 51), col("AnnualIncome", "numeric", 64), col("SpendingScore", "numeric", 84)], 200),
      answers: { unsupGoal: "cluster" }, excludedCols: [] },
    expect: [["task", "Clustering"], ["task", "KMeans"]],
  },
  {
    // Mirrors the app's built-in 400-row taxi sample: a timestamp is near-unique but must
    // stay a feature (not ID-like), and small-n regression must not claim "stratified" CV.
    name: "NYC Taxi 400-row sample — small-n regression with timestamp",
    source: "https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page",
    facts: { target: "fare_amount", task: { kind: "regression", targetType: "continuous" },
      prof: prof([col("trip_id", "categorical", 400, 0, true), col("pickup_datetime", "datetime", 400), col("pickup_zone", "categorical", 10), col("trip_distance", "numeric", 350), col("tip_amount", "numeric", 300), col("total_amount", "numeric", 380)], 400),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "nice", errorCost: "eq" }, excludedCols: ["tip_amount", "total_amount"] },
    expect: [["models", "Small dataset"], ["fe", "Datetime"], ["validation", "Repeated k-fold"]],
  },
  {
    name: "Santander Transaction — high-dim, imbalanced",
    source: "https://www.kaggle.com/c/santander-customer-transaction-prediction",
    facts: { target: "target", task: { kind: "classification", targetType: "binary", nClasses: 2, imbalance: 0.10 },
      prof: prof([col("ID_code", "categorical", 200000, 0, true), ...Array.from({ length: 12 }, (_, i) => col("var_" + i, "numeric", 200000))], 200000),
      answers: { timeDependent: false, needsProbs: false, regulated: false, interpretability: "no", errorCost: "fn" }, excludedCols: [] },
    expect: [["task", "classification"], ["metrics", "PR-AUC"], ["metrics", "avoid accuracy"], ["leakage", "ID-like"]],
  },
];

export { DATASETS };
