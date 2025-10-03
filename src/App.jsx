import React, { useEffect, useMemo, useState, useRef } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

// ===== KAUS BRACKET CALCULATOR — Compact Stable Build =====
const STORAGE_KEY = "kaus_snapshots_v2";

const defaultScheme = [
  { label: "≤91", max: 91 },
  { label: "92–93", max: 93 },
  { label: "94–95", max: 95 },
  { label: "96–97", max: 97 },
  { label: "98–99", max: 99 },
  { label: "100+", max: Infinity },
];

const findBracket = (scheme, t) => scheme.findIndex((b) => t <= b.max);
const clamp = (i, n) => Math.max(0, Math.min(n - 1, i));

function bracketContainsActual(scheme, idx, t) {
  if (!scheme || idx < 0 || idx >= scheme.length) return false;
  const hi = scheme[idx]?.max;
  const lo = idx > 0 ? scheme[idx - 1].max : -Infinity;
  const val = Number(t);
  if (!Number.isFinite(val)) return false;
  return val <= hi && val > lo;
}

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveSnapshots(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {}
}

function defaultSaveLabel() {
  const d = new Date();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = (d.getFullYear() % 100).toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${mm}-${dd}-${yy} (${hh}:${mi})`;
}

function computeBiases(snapshots, windowSize) {
  const srcSum = new Map();
  const srcCnt = new Map();
  const withActual = snapshots.filter((s) => typeof s.actual === "number");
  const take = windowSize > 0 ? withActual.slice(0, windowSize) : withActual;
  for (const s of take) {
    const actual = Number(s.actual);
    (s.rows || []).forEach((r) => {
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

export default function BracketCalculator() {
  // Inputs
  const [rows, setRows] = useState([
    { id: 1, source: "CBS Austin", forecast: 97, weight: 0.25 },
    { id: 2, source: "KXAN", forecast: 96, weight: 0.2 },
    { id: 3, source: "FOX", forecast: 96, weight: 0.2 },
    { id: 4, source: "KVUE", forecast: 95, weight: 0.15 },
    { id: 5, source: "WU", forecast: 95, weight: 0.0667 },
    { id: 6, source: "NWS", forecast: 96, weight: 0.0667 },
    { id: 7, source: "AW", forecast: 96, weight: 0.0667 },
  ]);
  const [scheme, setScheme] = useState(defaultScheme);
  const [showEditor, setShowEditor] = useState(false);

  // Snapshots
  const [snapshots, setSnapshots] = useState([]);
  const [saveName, setSaveName] = useState(defaultSaveLabel());
  const [actualInput, setActualInput] = useState("");
  const [actualAttachIds, setActualAttachIds] = useState([]);
  useEffect(() => {
    setSnapshots(loadSnapshots());
  }, []);

  // File input ref for uploads
  const fileInputRef = useRef(null);

  // Prior & Bias
  const [usePrior, setUsePrior] = useState(false);
  const [priorId, setPriorId] = useState("");
  const [useBias, setUseBias] = useState(false);
  const [biasWindow, setBiasWindow] = useState(0);
  const biases = useMemo(() => computeBiases(snapshots, biasWindow), [snapshots, biasWindow]);
  const biasPreview = useMemo(
    () => rows.map((r) => ({ source: r.source, bias: +(biases[r.source]?.toFixed?.(2) ?? 0) })),
    [rows, biases]
  );
  const biasUsed = useMemo(() => {
    const withActual = (snapshots || []).filter((s) => typeof s.actual === "number");
    const take = biasWindow > 0 ? withActual.slice(0, biasWindow) : withActual;
    return take.map((s) => ({ id: s.id, name: s.name, actual: s.actual, savedAt: s.savedAt }));
  }, [snapshots, biasWindow]);

  // Accuracy summary (top bracket correctness)
  const accuracy = useMemo(() => {
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
  }, [snapshots]);

  // Per-source stats (±1/±2/±3, MAE)
  const perSourceStats = useMemo(() => {
    const withActual = (snapshots || []).filter((s) => typeof s.actual === "number");
    const sums = new Map();
    const counts = new Map();
    const within = new Map();
    for (const s of withActual) {
      const actual = Number(s.actual);
      (s.rows || []).forEach((r) => {
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
  }, [snapshots]);

  // === Auto-Weights (inverse-MAE) ===
  const [useAutoWeights, setUseAutoWeights] = useState(true);
  const autoWeightsMap = useMemo(() => {
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
  }, [useAutoWeights, perSourceStats]);

  // Preserve exact auto-weights from a loaded snapshot (takes precedence over live autoWeightsMap)
  const [autoWeightsOverride, setAutoWeightsOverride] = useState(null);

  // Build the effective rows that feed probabilities (manual vs auto)
  const effectiveRows = useMemo(() => {
    if (!useAutoWeights) return rows;
    const map = autoWeightsOverride || autoWeightsMap;
    if (!map) return rows;
    return rows.map((r) => ({ ...r, weight: map[r.source] ?? 0 }));
  }, [rows, useAutoWeights, autoWeightsMap, autoWeightsOverride]);

  // Accuracy trend data (chronological cumulative %)
  const accuracyTrendData = useMemo(() => {
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
  }, [snapshots]);

  // Probabilities (use effectiveRows from manual or auto-weights)
  const totalWeight = useMemo(() => effectiveRows.reduce((s, r) => s + (Number(r.weight) || 0), 0), [effectiveRows]);
  const normalizedRows = useMemo(() => {
    const tw = totalWeight || 1;
    return effectiveRows.map((r) => ({ ...r, nWeight: (Number(r.weight) || 0) / tw }));
  }, [effectiveRows, totalWeight]);
  const adjustedRows = useMemo(() => {
    if (!useBias) return normalizedRows.map((r) => ({ ...r, adjForecast: r.forecast }));
    return normalizedRows.map((r) => {
      const bias = Number.isFinite(biases[r.source]) ? biases[r.source] : 0;
      const adj = Math.max(-5, Math.min(5, bias));
      return { ...r, adjForecast: Number(r.forecast) + adj };
    });
  }, [normalizedRows, useBias, biases]);
  const baseProbs = useMemo(() => {
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
  }, [adjustedRows, scheme]);
  const blendedProbs = useMemo(() => {
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
  }, [usePrior, priorId, baseProbs, snapshots, scheme]);
  const rounded = useMemo(() => blendedProbs.map((x) => Math.round(x * 1000) / 10), [blendedProbs]);
  const sumRounded = rounded.reduce((s, x) => s + x, 0);

  // Helper: keep auto-weights toggle in sync and clear overrides when turning off
  function handleSetUseAutoWeights(checked) {
    setUseAutoWeights(checked);
    if (!checked) setAutoWeightsOverride(null);
  }

  // Snapshot actions
  function handleSaveSnapshot() {
    const id = `${Date.now()}`;
    const probs = blendedProbs.slice();
    const appliedRows = (useAutoWeights && autoWeightsMap)
      ? rows.map((r) => ({ ...r, weight: autoWeightsMap?.[r.source] ?? 0 }))
      : rows;
    const payload = {
      id,
      name: saveName || defaultSaveLabel(),
      savedAt: new Date().toISOString(),
      rows: appliedRows,
      scheme,
      probs,
      weightMode: useAutoWeights ? "auto" : "manual",
    };
    const next = [payload, ...snapshots];
    setSnapshots(next); saveSnapshots(next);
  }
  function handleAttachActualToSnapshots() {
    const val = Number(actualInput); if (!Number.isFinite(val)) return; if (!actualAttachIds.length) return;
    const next = snapshots.map((s) => (actualAttachIds.includes(s.id) ? { ...s, actual: val } : s));
    setSnapshots(next); saveSnapshots(next); setActualAttachIds([]); setActualInput("");
  }
  function handleClearActualOnSnapshots() {
    if (!actualAttachIds.length) return;
    const next = snapshots.map((s) => (actualAttachIds.includes(s.id) ? { ...s, actual: undefined } : s));
    setSnapshots(next); saveSnapshots(next); setActualAttachIds([]);
  }
  function handleDeleteSnapshot(id) {
    const next = snapshots.filter((s) => s.id !== id);
    setSnapshots(next); saveSnapshots(next); if (priorId === id) setPriorId("");
  }
  function applySnapshotInputs(id) {
    const snap = snapshots.find((s) => s.id === id); if (!snap) return;
    setRows(snap.rows); setScheme(snap.scheme);
    const wasAuto = snap.weightMode === "auto";
    setUseAutoWeights(wasAuto);
    if (wasAuto) {
      const o = {};
      (snap.rows || []).forEach((r) => { if (r?.source) o[r.source] = Number(r.weight) || 0; });
      setAutoWeightsOverride(o);
    } else {
      setAutoWeightsOverride(null);
    }
  }

  // === Backup & Restore helpers ===
  function downloadData() {
    try {
      const data = localStorage.getItem(STORAGE_KEY) || "[]";
      const blob = new Blob([data], { type: "application/json" });
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

  function handleUploadData(e) {
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
          alert("Backup imported.");
        }
      } catch (err) {
        alert("Could not read file.");
      } finally {
        if (e?.target) e.target.value = ""; // reset file chooser
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Forecast → Bracket Percentages</h1>
        <p className="text-sm text-gray-700 mb-4">Enter forecasts & weights. Save snapshots, attach actuals, use prior, and auto-learn bias.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* LEFT COLUMN */}
          <div className="space-y-4">
            {/* Forecast table */}
            <div className="overflow-x-auto rounded-2xl shadow bg-white">
              <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                <div className="text-sm font-medium">Source Forecast (°F) Weight</div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={useAutoWeights}
                    onChange={(e) => handleSetUseAutoWeights(e.target.checked)}
                    disabled={perSourceStats.length === 0}
                  />
                  <span>Auto-weights from accuracy</span>
                </label>
              </div>
              {useAutoWeights && perSourceStats.length === 0 && !autoWeightsOverride && (
                <div className="px-3 pb-1 text-[11px] text-amber-700">Need snapshots with actuals to compute weights.</div>
              )}
              {useAutoWeights && autoWeightsOverride && (
                <div className="px-3 pb-1 text-[11px] text-blue-700">Using weights saved in the loaded snapshot.</div>
              )}
              {useAutoWeights && !autoWeightsOverride && autoWeightsMap && (
                <div className="px-3 pb-1 text-[11px] text-gray-600">Weights derived from inverse MAE (normalized).</div>
              )}
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-3 text-left">Source</th>
                    <th className="p-3 text-right">Forecast (°F)</th>
                    <th className="p-3 text-right">Weight{useAutoWeights ? " (auto)" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className={idx % 2 ? "bg-white" : "bg-gray-50"}>
                      <td className="p-2"><input className="w-full px-2 py-1 rounded border" value={r.source} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, source: e.target.value } : x)))} /></td>
                      <td className="p-2 text-right"><input type="number" className="w-24 text-right px-2 py-1 rounded border" value={r.forecast} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, forecast: Number(e.target.value) } : x)))} /></td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-24 text-right px-2 py-1 rounded border disabled:bg-gray-100"
                          value={useAutoWeights ? ((autoWeightsOverride?.[r.source] ?? autoWeightsMap?.[r.source] ?? 0).toFixed(3)) : r.weight}
                          onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, weight: Number(e.target.value) } : x)))}
                          disabled={useAutoWeights}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Save snapshot */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Save this forecast</h3>
              <div className="flex gap-2 items-center">
                <input className="flex-1 px-2 py-1 rounded border" value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g., 9-21-25 (early)" />
                <button onClick={handleSaveSnapshot} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">Save</button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Snapshots save inputs, brackets, and probabilities.</p>
            </div>

            {/* Attach actuals */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Final actual high → attach to saved</h3>
              <div className="flex flex-wrap gap-3 items-center mb-3">
                <label className="text-sm">Actual</label>
                <input type="number" className="w-24 text-right px-2 py-1 rounded border" value={actualInput} onChange={(e) => setActualInput(e.target.value)} placeholder="e.g. 97" />
                <button className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200" onClick={handleAttachActualToSnapshots} disabled={!actualAttachIds.length || actualInput === ""}>Attach</button>
                <button className="px-3 py-1 rounded-2xl border shadow bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={handleClearActualOnSnapshots} disabled={!actualAttachIds.length}>Clear on selected</button>
              </div>
              {snapshots.length === 0 ? (
                <p className="text-sm text-gray-600">No saved forecasts yet.</p>
              ) : (
                <div className="max-h-48 overflow-auto rounded border p-2">
                  <ul className="space-y-1">
                    {snapshots.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={actualAttachIds.includes(s.id)} onChange={() => setActualAttachIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])} />
                          <span className="font-medium">{s.name}</span>
                        </label>
                        <span className="text-xs text-gray-600">
                          {new Date(s.savedAt).toLocaleString()}
                          {typeof s.actual === "number" && <span className="ml-2">• Actual: <span className="font-mono">{s.actual}</span>°</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-gray-600 mt-2">Attaching actuals powers bias learning & accuracy metrics.</p>
            </div>

            {/* Saved list (show ~5 items tall, scroll for more) */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Saved forecasts (read-only)</h3>
              {snapshots.length === 0 ? (
                <p className="text-sm text-gray-600">No saved forecasts yet.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  <ul className="divide-y">
                    {snapshots.map((s) => (
                      <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{s.name}</div>
                          <div className="text-xs text-gray-600">
                            {new Date(s.savedAt).toLocaleString()}
                            {typeof s.actual === "number" && <span className="ml-2">• Actual: <span className="font-mono">{s.actual}</span>°</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200" onClick={() => applySnapshotInputs(s.id)}>Load inputs</button>
                          <button className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200" onClick={() => { setUsePrior(true); setPriorId(s.id); }}>Use as prior</button>
                          <button className="px-2 py-1 rounded border bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={() => handleDeleteSnapshot(s.id)}>Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Backup & Restore */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Backup & Restore</h3>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={downloadData} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">Download data (.json)</button>
                <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleUploadData} />
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">Upload data (.json)</button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Exports/imports your saved forecasts, actuals, and settings for this tool.</p>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">
            {/* Bracket probabilities + editor */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Implied bracket probabilities</h2>
                <button onClick={() => setShowEditor((v) => !v)} className="px-2 py-1 text-xs rounded border bg-gray-100 hover:bg-gray-200">{showEditor ? "Done" : "Edit"}</button>
              </div>
              <ul className="space-y-1">
                {scheme.map((b, i) => (
                  <li key={`${b.label}-${i}`} className="flex justify-between text-sm">
                    <span>{b.label}</span>
                    <span className="font-mono">{(rounded[i] ?? 0).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between text-xs text-gray-700 mt-2"><span>Sum (1-dec rounding):</span><span className="font-mono">{sumRounded.toFixed(1)}%</span></div>
              {showEditor && (
                <div className="mt-3 overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr>
                        <th className="p-2 text-left">Bracket</th>
                        <th className="p-2 text-right">Max</th>
                        <th className="p-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheme.map((b, idx) => (
                        <tr key={idx} className={idx % 2 ? "bg-white" : "bg-gray-50"}>
                          <td className="p-2"><input className="w-full px-2 py-1 rounded border" value={b.label} onChange={(e) => setScheme((prev) => prev.map((bb, i) => i === idx ? { ...bb, label: e.target.value } : bb))} /></td>
                          <td className="p-2 text-right"><input type="number" className="w-20 text-right px-2 py-1 rounded border" value={b.max === Infinity ? "" : b.max} placeholder={b.max === Infinity ? "∞" : ""} onChange={(e) => setScheme((prev) => prev.map((bb, i) => i === idx ? { ...bb, max: e.target.value === "" ? Infinity : Number(e.target.value) } : bb))} /></td>
                          <td className="p-2 text-right"><button onClick={() => setScheme((prev) => prev.filter((_, i) => i !== idx))} className="px-2 py-1 rounded border bg-rose-50 text-rose-700 hover:bg-rose-100" disabled={scheme.length <= 1}>−</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2 flex justify-end"><button onClick={() => setScheme((prev) => [...prev, { label: "New", max: Infinity }])} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">+ Add</button></div>
                </div>
              )}
            </div>

            {/* Prior */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Optional prior (on/off)</h3>
              <div className="flex items-center gap-2 mb-2">
                <input id="usePrior" type="checkbox" checked={usePrior} onChange={(e) => setUsePrior(e.target.checked)} />
                <label htmlFor="usePrior" className="text-sm">Blend equally (50/50) with selected forecast</label>
              </div>
              <select className="px-2 py-1 rounded border" disabled={!usePrior} value={priorId} onChange={(e) => setPriorId(e.target.value)}>
                <option value="">Select saved forecast…</option>
                {snapshots.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
              </select>
              {usePrior && priorId && <p className="text-xs text-gray-600 mt-2">Requires same bracket labels; otherwise ignored.</p>}
            </div>

            {/* Bias */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Bias learning (from saved actuals)</h3>
              <div className="flex items-center gap-3 mb-2">
                <input id="useBias" type="checkbox" checked={useBias} onChange={(e) => setUseBias(e.target.checked)} />
                <label htmlFor="useBias" className="text-sm">Apply learned bias to forecasts</label>
                <label className="text-sm ml-2">Look-back</label>
                <input type="number" min={0} className="w-20 text-right px-2 py-1 rounded border" value={biasWindow} onChange={(e) => setBiasWindow(Math.max(0, Number(e.target.value)||0))} />
                <span className="text-xs text-gray-600">(0 = all)</span>
              </div>
              <ul className="grid grid-cols-2 gap-x-4 text-xs">
                {biasPreview.map((b) => (
                  <li key={b.source} className="flex justify-between"><span>{b.source}</span><span className="font-mono">{(b.bias >= 0 ? "+" : "") + b.bias}</span></li>
                ))}
              </ul>
              <div className="mt-3">
                <div className="text-xs text-gray-700 mb-1">Using {biasUsed.length} snapshot{biasUsed.length !== 1 ? "s" : ""}:</div>
                {biasUsed.length === 0 ? (
                  <p className="text-xs text-gray-600">No snapshots with attached actuals yet.</p>
                ) : (
                  <ul className="text-xs divide-y rounded border max-h-32 overflow-auto">
                    {biasUsed.map((s) => (
                      <li key={s.id} className="py-1 px-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-[11px] text-gray-600 truncate">{new Date(s.savedAt).toLocaleString()}</div>
                        </div>
                        <div className="text-[11px] text-gray-700 whitespace-nowrap">Actual: <span className="font-mono">{s.actual}</span>°</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-3 p-2 rounded-xl border bg-gray-50">
                <div className="text-sm font-semibold">Forecast Accuracy</div>
                <div className="text-xs text-gray-700 mt-1">{accuracy.total > 0 ? `${accuracy.correct} of ${accuracy.total} correct (${accuracy.pct.toFixed(1)}%)` : "No snapshots with actuals yet."}</div>
                <div className="text-[11px] text-gray-600 mt-1">Counts as correct when actual falls within the highest-probability bracket.</div>
              </div>
            </div>

            {/* Accuracy Trend (compact) */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Accuracy trend over time</h3>
              {accuracyTrendData.length === 0 ? (
                <p className="text-sm text-gray-600">No data yet.</p>
              ) : (
                <div className="w-full h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={accuracyTrendData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => `${v}%`} />
                      <Line type="monotone" dataKey="acc" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="text-[11px] text-gray-600 mt-1">Cumulative % correct (chronological).</p>
            </div>

            {/* Per-Source Accuracy (bottom, compact) */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Per-source accuracy</h3>
              {perSourceStats.length === 0 ? (
                <p className="text-sm text-gray-600">No data yet.</p>
              ) : (
                <div className="overflow-x-auto max-h-40 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-700">
                        <th className="p-2">Source</th>
                        <th className="p-2 text-right">N</th>
                        <th className="p-2 text-right">±1°F</th>
                        <th className="p-2 text-right">±2°F</th>
                        <th className="p-2 text-right">±3°F</th>
                        <th className="p-2 text-right">MAE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perSourceStats.map((r, i) => (
                        <tr key={r.source} className={i % 2 ? "bg-white" : "bg-gray-50"}>
                          <td className="p-2">{r.source}</td>
                          <td className="p-2 text-right font-mono">{r.n}</td>
                          <td className="p-2 text-right font-mono">{r.p1.toFixed(0)}%</td>
                          <td className="p-2 text-right font-mono">{r.p2.toFixed(0)}%</td>
                          <td className="p-2 text-right font-mono">{r.p3.toFixed(0)}%</td>
                          <td className="p-2 text-right font-mono">{r.mae.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-gray-600 mt-1">Sorted by MAE (lower is better).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
