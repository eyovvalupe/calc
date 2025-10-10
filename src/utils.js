import { STORAGE_KEY } from './types.js';

// ===== UTILITY FUNCTIONS =====

export const findBracket = (scheme, t) => {
  if (!Array.isArray(scheme) || scheme.length === 0) return -1;
  return scheme.findIndex((b) => t <= b.max);
};

export const clamp = (i, n) => Math.max(0, Math.min(n - 1, i));

export function bracketContainsActual(scheme, idx, t) {
  if (!scheme || idx < 0 || idx >= scheme.length) return false;
  const hi = scheme[idx]?.max;
  const lo = idx > 0 ? scheme[idx - 1].max : -Infinity;
  const val = Number(t);
  if (!Number.isFinite(val)) return false;
  return val <= hi && val > lo;
}

export function loadSnapshots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnapshots(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch { }
}

export function defaultSaveLabel() {
  const d = new Date();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = (d.getFullYear() % 100).toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${mm}-${dd}-${yy} (${hh}:${mi})`;
}

export function computeBiases(snapshots, currentRows, windowSize) {
  const srcSum = new Map();
  const srcCnt = new Map();
  // Safety check for undefined or non-array snapshots
  if (!Array.isArray(snapshots) || !Array.isArray(currentRows)) {
    return {};
  }
  const withActual = snapshots.filter((s) => typeof s.actual === "number");
  const take = windowSize > 0 ? withActual.slice(0, windowSize) : withActual;

  // Use current tab's rows for all snapshots since rows are no longer in snapshots
  for (const s of take) {
    const actual = Number(s.actual);
    currentRows.forEach((r) => {
      const name = r.source?.trim();
      const fc = Number(r.forecast);
      if (!name || !Number.isFinite(fc)) return;
      const err = actual - fc; // signed
      srcSum.set(name, (srcSum.get(name) || 0) + err);
      srcCnt.set(name, (srcCnt.get(name) || 0) + 1);
    });
  }
  const out = {};
  for (const [name, sum] of srcSum.entries()) out[name] = sum / (srcCnt.get(name) || 1);
  return out;
}

export function downloadData() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY) || "[]";
    const snapshots = JSON.parse(rawData);

    // Update savedAt timestamp for all snapshots
    const now = new Date();
    const localISOTime = now.toISOString();
    const updatedSnapshots = snapshots.map(snapshot => ({
      ...snapshot,
      savedAt: localISOTime
    }));

    const updatedData = JSON.stringify(updatedSnapshots, null, 2);
    const blob = new Blob([updatedData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `kaus_snapshots_backup_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert("Download failed.");
  }
}

export function handleUploadData(e, saveSnapshots, setSnapshots, setPriorId, setAutoWeightsOverride) {
  const file = e?.target?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        alert("Invalid backup file.");
      } else {
        saveSnapshots(parsed);
        setSnapshots(parsed);
        setPriorId("");
        setAutoWeightsOverride(null);
      }
    } catch (err) {
      alert("Could not read file.");
    } finally {
      if (e?.target) e.target.value = ""; // reset file chooser
    }
  };
  reader.readAsText(file);
}

export function calculateMarketMetrics(marketOptions, deposits) {
  const totalInvestment = Object.values(deposits).reduce((sum, deposit) => sum + deposit, 0);

  return marketOptions.map(market => {
    const deposit = deposits[market.id] || 0;
    const yesPrice = market.yesPrice;

    let contracts = 0;
    let totalCost = 0;
    let minPayout = 0;
    let profit = 0;
    let profitLoss = 0;

    if (deposit > 0 && yesPrice > 0) {
      contracts = Math.floor(deposit / yesPrice);
      totalCost = contracts * yesPrice;
      minPayout = contracts; // Each contract pays $1 if correct (integer)
      profit = minPayout - totalCost;
      profitLoss = minPayout - totalInvestment; // Payout - total investment across all rows
    }

    return {
      ...market,
      deposit,
      contracts,
      totalCost: totalCost.toFixed(2),
      minPayout: minPayout.toFixed(0), // Integer payout
      profit: profit.toFixed(2),
      profitLoss: profitLoss.toFixed(2),
    };
  });
}

export function calculateAccuracy(snapshots, bracketContainsActual) {
  const withActual = (snapshots || []).filter(
    (s) => typeof s.actual === "number" && Array.isArray(s.probs) && Array.isArray(s.scheme) && s.scheme.length > 0
  );
  const total = withActual.length;
  let correct = 0;
  for (const s of withActual) {
    const probs = s.probs || [];
    let maxIdx = -1,
      maxVal = -Infinity;
    for (let i = 0; i < probs.length; i++) {
      const v = Number(probs[i]) || 0;
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
    }
    if (maxIdx >= 0 && bracketContainsActual(s.scheme, maxIdx, s.actual)) correct++;
  }
  return { correct, total, pct: total ? (correct / total) * 100 : 0 };
}

export function calculatePerSourceStats(snapshots, currentRows) {
  const withActual = (snapshots || []).filter((s) => typeof s.actual === "number");
  if (!Array.isArray(currentRows)) {
    return [];
  }

  const sums = new Map();
  const counts = new Map();
  const within = new Map();
  for (const s of withActual) {
    const actual = Number(s.actual);
    // Use current tab's rows since rows are no longer in snapshots
    currentRows.forEach((r) => {
      const name = r.source?.trim();
      const fc = Number(r.forecast);
      if (!name || !Number.isFinite(fc)) return;
      const err = Math.abs(actual - fc);
      sums.set(name, (sums.get(name) || 0) + err);
      counts.set(name, (counts.get(name) || 0) + 1);
      const w = within.get(name) || { 1: 0, 2: 0, 3: 0 };
      if (err <= 1) w[1] += 1;
      if (err <= 2) w[2] += 1;
      if (err <= 3) w[3] += 1;
      within.set(name, w);
    });
  }
  const rows = Array.from(counts.keys()).map((name) => {
    const n = counts.get(name) || 0;
    const mae = n ? (sums.get(name) || 0) / n : 0;
    const w = within.get(name) || { 1: 0, 2: 0, 3: 0 };
    return { source: name, n, mae, p1: n ? (w[1] / n) * 100 : 0, p2: n ? (w[2] / n) * 100 : 0, p3: n ? (w[3] / n) * 100 : 0 };
  });
  rows.sort((a, b) => a.mae - b.mae);
  return rows;
}

export function calculateAccuracyTrendData(snapshots, bracketContainsActual) {
  const withActual = (snapshots || [])
    .filter((s) => typeof s.actual === "number" && Array.isArray(s.probs) && Array.isArray(s.scheme) && s.scheme.length > 0)
    .slice()
    .sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime());
  let correct = 0;
  return withActual.map((s, i) => {
    const probs = s.probs || [];
    let maxIdx = probs.reduce((best, v, i2) => (Number(v) > Number(probs[best]) ? i2 : best), 0);
    const isCorrect = maxIdx >= 0 && bracketContainsActual(s.scheme, maxIdx, s.actual);
    if (isCorrect) correct += 1;
    const pct = (correct / (i + 1)) * 100;
    return { t: new Date(s.savedAt).toLocaleDateString(), acc: +pct.toFixed(1) };
  });
}

export function calculateAutoWeights(perSourceStats, useAutoWeights) {
  if (!useAutoWeights) return null;
  if (!perSourceStats || perSourceStats.length === 0) return null;
  // Score = 1 / (MAE + epsilon) so lower MAE => higher score
  const eps = 0.5; // smoothing so zeros don't explode
  const scores = {};
  perSourceStats.forEach((r) => {
    const s = 1 / (Math.max(0, r.mae) + eps);
    scores[r.source] = s;
  });
  const sum = Object.values(scores).reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  const norm = {};
  Object.keys(scores).forEach((k) => {
    norm[k] = scores[k] / sum;
  });
  return norm;
}

export function calculateBaseProbs(adjustedRows, scheme, findBracket, clamp) {
  if (!Array.isArray(scheme) || scheme.length === 0) return [];
  if (!Array.isArray(adjustedRows)) return Array(scheme.length).fill(0);

  const out = Array(scheme.length).fill(0);
  const bleed = 0.3;
  adjustedRows.forEach((r) => {
    const f = +r.adjForecast; if (!Number.isFinite(f)) return;
    const b = findBracket(scheme, f); const w = r.nWeight || 0; if (b < 0) return;
    const n = scheme.length; const baseShare = (1 - bleed) * w; const bleedShare = bleed * w;
    out[clamp(b, n)] += baseShare;
    if (bleedShare > 0) {
      if (b - 1 >= 0 && b + 1 < n) { out[b - 1] += bleedShare / 2; out[b + 1] += bleedShare / 2; }
      else if (b - 1 >= 0) out[b - 1] += bleedShare;
      else if (b + 1 < n) out[b + 1] += bleedShare;
      else out[b] += bleedShare;
    }
  });
  return out;
}

export function calculateBlendedProbs(usePrior, priorId, baseProbs, snapshots, scheme) {
  if (!usePrior || !priorId) return baseProbs;
  const snap = snapshots.find((s) => s.id === priorId);
  if (!snap) return baseProbs;
  const sameLength = snap.scheme?.length === scheme.length;
  const sameLabels = sameLength && snap.scheme.every((b, i) => b.label === scheme[i].label);
  if (!sameLabels) return baseProbs;
  const prior = snap.probs;
  const out = baseProbs.map((x, i) => 0.5 * x + 0.5 * (prior[i] || 0));
  const s = out.reduce((a, b) => a + b, 0) || 1;
  return out.map((v) => v / s);
}
