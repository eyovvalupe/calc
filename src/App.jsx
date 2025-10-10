import React, { useEffect, useMemo, useState, useRef } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { defaultScheme, defaultRows } from './types.js';
import {
  findBracket,
  clamp,
  bracketContainsActual,
  loadSnapshots,
  saveSnapshots,
  defaultSaveLabel,
  computeBiases,
  downloadData,
  calculateAccuracy,
  calculatePerSourceStats,
  calculateAccuracyTrendData,
  calculateAutoWeights,
  calculateBaseProbs,
  calculateBlendedProbs
} from './utils.js';
import KalshiCalculator from './KalshiCalculator.jsx';

// ===== KAUS BRACKET CALCULATOR — Compact Stable Build =====

export default function BracketCalculator() {
  // Tabs state
  const [activeTab, setActiveTab] = useState('KAUS');
  const tabs = ['KAUS', 'KMIA', 'KMDW', 'KLAX', 'KNYC', 'KPHL', 'KDEN'];

  // Simplified tab data structure - each tab directly contains snapshots array
  const [tabData, setTabData] = useState(() => {
    // Try to load from existing snapshots system
    try {
      const existingSnapshots = loadSnapshots();
      const tabSourcesConfig = existingSnapshots.find(s => s.id === 'tab_sources_config');

      if (tabSourcesConfig && tabSourcesConfig.tabSources) {
        // Check if it's the new structure with rows and snapshots
        const hasNewStructure = tabs.every(tab => {
          const tabInfo = tabSourcesConfig.tabSources[tab];
          return tabInfo && typeof tabInfo === 'object' &&
            Array.isArray(tabInfo.snapshots) &&
            Array.isArray(tabInfo.rows);
        });

        if (hasNewStructure) {
          return tabSourcesConfig.tabSources;
        }

        // Migrate from old structure (arrays) to new structure (objects with rows + snapshots)
        const migratedData = {};
        tabs.forEach(tab => {
          const oldTabData = tabSourcesConfig.tabSources[tab];
          if (Array.isArray(oldTabData)) {
            // Old structure: tab was just an array of snapshots
            migratedData[tab] = {
              rows: defaultRows.map((row, index) => ({ ...row, id: index + 1 })),
              snapshots: oldTabData
            };
          } else {
            // Fallback
            migratedData[tab] = {
              rows: defaultRows.map((row, index) => ({ ...row, id: index + 1 })),
              snapshots: []
            };
          }
        });
        return migratedData;
      }
    } catch (error) {
      console.warn('Failed to load saved tab sources from snapshots:', error);
    }

    // Fallback to default initialization - each tab has rows and empty snapshots
    console.log("No existing data found, initializing all tabs with default rows and empty snapshots");
    const initialTabData = {};
    tabs.forEach(tab => {
      initialTabData[tab] = {
        rows: defaultRows.map((row, index) => ({ ...row, id: index + 1 })),
        snapshots: []
      };
    });
    return initialTabData;
  });

  // Get current tab's data (rows and snapshots)
  const currentTabInfo = tabData[activeTab] || { rows: [], snapshots: [] };
  const tabSnapshots = currentTabInfo.snapshots;
  const tabRows = currentTabInfo.rows;

  // Global state for current session (not tab-specific)
  const [scheme, setScheme] = useState(tabSnapshots[0]?.scheme || defaultScheme);
  const [currentSnapshotId, setCurrentSnapshotId] = useState(tabSnapshots[0]?.id || '')

  // Helper function to save tab data to localStorage
  const saveTabDataToStorage = (newTabData) => {
    try {
      const now = new Date();
      const localISOTime = now.toISOString();
      const tabSourcesEntry = {
        id: 'tab_sources_config',
        savedAt: localISOTime,
        tabSources: newTabData,
      };

      saveSnapshots([tabSourcesEntry]);
      setLastSaved(now.toLocaleTimeString());
    } catch (error) {
      console.warn('Failed to save tab data:', error);
    }
  };

  // Helper function to update current tab's rows
  const updateCurrentTabData = (updatedRows) => {
    const newTabData = {
      ...tabData,
      [activeTab]: {
        ...tabData[activeTab],
        rows: updatedRows
      }
    };

    setTabData(newTabData);
    saveTabDataToStorage(newTabData);
  };

  // Use rows from current tab
  const rows = tabRows;
  // Use global scheme (not tab-specific)
  const tabScheme = scheme;

  // Function to update snapshots for current tab
  const updateTabSnapshots = (newSnapshots) => {
    const newTabData = {
      ...tabData,
      [activeTab]: {
        ...tabData[activeTab],
        snapshots: newSnapshots
      }
    };

    setTabData(newTabData);
    saveTabDataToStorage(newTabData);
  };





  const [showEditor, setShowEditor] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const [saveName, setSaveName] = useState(defaultSaveLabel());
  const [actualInput, setActualInput] = useState("");
  const [actualAttachIds, setActualAttachIds] = useState([]);

  useEffect(() => {
    const loadedSnapshots = loadSnapshots();

    // If no data in localStorage, ensure all tabs start with empty lists
    if (loadedSnapshots.length === 0) {
      console.log("No data in localStorage, initializing with empty tabs");
      return; // tabData is already initialized with empty arrays
    }

    // Check if we have tab_sources_config, if not, migrate global snapshots to tab structure
    const tabSourcesConfig = loadedSnapshots.find(s => s.id === 'tab_sources_config');
    if (!tabSourcesConfig && loadedSnapshots.length > 0) {
      // Migrate existing snapshots to KAUS tab for backward compatibility
      console.log("Migrating legacy snapshots to KAUS tab");
      const migratedTabData = { ...tabData };
      migratedTabData.KAUS = loadedSnapshots.filter(s => s.id !== 'tab_sources_config');
      setTabData(migratedTabData);
    }
  }, []);



  // Use current tab's snapshots
  const displaySnapshots = tabSnapshots;

  // File input ref for uploads
  const fileInputRef = useRef(null);

  // Global settings (not tab-specific)
  const [usePrior, setUsePrior] = useState(false);
  const [priorId, setPriorId] = useState("");
  const [useBias, setUseBias] = useState(false);
  const [biasWindow, setBiasWindow] = useState(0);
  const biases = useMemo(() => computeBiases(displaySnapshots, rows, biasWindow), [displaySnapshots, rows, biasWindow]);
  const biasPreview = useMemo(
    () => rows.map((r) => ({ source: r.source, bias: +(biases[r.source]?.toFixed?.(2) ?? 0) })),
    [rows, biases]
  );
  const biasUsed = useMemo(() => {
    const withActual = (displaySnapshots || []).filter((s) => typeof s.actual === "number");
    const take = biasWindow > 0 ? withActual.slice(0, biasWindow) : withActual;
    return take.map((s) => ({ id: s.id, name: s.name, actual: s.actual, savedAt: s.savedAt }));
  }, [displaySnapshots, biasWindow]);

  // Accuracy summary (top bracket correctness) - tab-specific
  const accuracy = useMemo(() => {
    return calculateAccuracy(displaySnapshots, bracketContainsActual);
  }, [displaySnapshots]);

  // Per-source stats (±1/±2/±3, MAE) - tab-specific
  const perSourceStats = useMemo(() => {
    return calculatePerSourceStats(displaySnapshots, rows);
  }, [displaySnapshots, rows]);

  // === Auto-Weights (inverse-MAE) === - Global settings
  const [useAutoWeights, setUseAutoWeights] = useState(true);
  const [autoWeightsOverride, setAutoWeightsOverride] = useState(null);

  const autoWeightsMap = useMemo(() => {
    return calculateAutoWeights(perSourceStats, useAutoWeights);
  }, [useAutoWeights, perSourceStats]);

  // Build the effective rows that feed probabilities (manual vs auto)
  const effectiveRows = useMemo(() => {
    if (!useAutoWeights) return rows;
    const map = autoWeightsOverride || autoWeightsMap;
    if (!map) return rows;
    return rows.map((r) => ({ ...r, weight: map[r.source] ?? 0 }));
  }, [rows, useAutoWeights, autoWeightsMap, autoWeightsOverride]);

  // Accuracy trend data (chronological cumulative %) - tab-specific
  const accuracyTrendData = useMemo(() => {
    return calculateAccuracyTrendData(displaySnapshots, bracketContainsActual);
  }, [displaySnapshots]);

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
    return calculateBaseProbs(adjustedRows, tabScheme, findBracket, clamp);
  }, [adjustedRows, tabScheme]);
  const blendedProbs = useMemo(() => {
    return calculateBlendedProbs(usePrior, priorId, baseProbs, displaySnapshots, tabScheme);
  }, [usePrior, priorId, baseProbs, displaySnapshots, tabScheme]);
  const rounded = useMemo(() => blendedProbs.map((x) => Math.round(x * 1000) / 10), [blendedProbs]);
  const sumRounded = rounded.reduce((s, x) => s + x, 0);

  // Helper: keep auto-weights toggle in sync and clear overrides when turning off
  function handleSetUseAutoWeights(checked) {
    setUseAutoWeights(checked);
    if (!checked) setAutoWeightsOverride(null);
  }

  // Functions to manage sources for current tab
  function addSource() {
    const newId = Math.max(0, ...rows.map(r => r.id)) + 1;
    const newRows = [...rows, { id: newId, source: "", forecast: 0, weight: 0 }];
    console.log(newRows)
    updateCurrentTabData(newRows);
  }

  function removeSource(id) {
    const newRows = rows.filter(r => r.id !== id);
    updateCurrentTabData(newRows);
  }

  function updateSource(id, field, value) {
    const updatedRows = rows.map(r => {
      if (r.id === id) {
        const updatedRow = { ...r, [field]: value };
        // For source field, ensure it's properly trimmed and saved
        if (field === 'source') {
          updatedRow.source = String(value || '');
        }
        return updatedRow;
      }
      return r;
    });
    updateCurrentTabData(updatedRows);
  }

  // Snapshot actions - Save to current tab
  function handleSaveSnapshot() {
    const id = `${Date.now()}`;
    const now = new Date();
    const localISOTime = now.toISOString();
    const probs = blendedProbs.slice();
    const payload = {
      id,
      savedAt: localISOTime,
      name: saveName || defaultSaveLabel(),
      scheme: tabScheme,
      probs,
      weightMode: useAutoWeights ? "auto" : "manual",
    };

    // Add to current tab's snapshots
    const updatedSnapshots = [payload, ...tabSnapshots];
    updateTabSnapshots(updatedSnapshots);
    setSaveName(defaultSaveLabel());
  }
  function handleAttachActualToSnapshots() {
    const val = Number(actualInput); if (!Number.isFinite(val)) return; if (!actualAttachIds.length) return;
    // Update snapshots in current tab
    const updatedSnapshots = tabSnapshots.map((s) => {
      if (actualAttachIds.includes(s.id)) {
        return { ...s, actual: val };
      }
      return s;
    });
    updateTabSnapshots(updatedSnapshots);
    setActualAttachIds([]);
    setActualInput("");
  }

  function handleClearActualOnSnapshots() {
    if (!actualAttachIds.length) return;
    // Update snapshots in current tab
    const updatedSnapshots = tabSnapshots.map((s) => {
      if (actualAttachIds.includes(s.id)) {
        return { ...s, actual: undefined };
      }
      return s;
    });
    updateTabSnapshots(updatedSnapshots);
    setActualAttachIds([]);
  }

  function handleDeleteSnapshot(id) {
    const updatedSnapshots = tabSnapshots.filter((s) => s.id !== id);
    updateTabSnapshots(updatedSnapshots);
    if (priorId === id) setPriorId("");
  }

  function updateCurrentTabDataScheme() {
    const data = tabSnapshots.map(item => {
      if (item.id != currentSnapshotId) return item;
      return { ...item, scheme: tabScheme };
    })
    updateTabSnapshots(data);
  }

  function applySnapshotInputs(id) {
    setCurrentSnapshotId(id);
    const snap = tabSnapshots.find((s) => s.id === id);
    if (!snap) {
      console.error("Snapshot not found:", id);
      return;
    }

    // Apply the snapshot's data to current session
    // Note: rows are not stored in snapshots anymore, they're in the tab

    if (snap.scheme) {
      console.log("Loading scheme:", snap.scheme);
      setScheme(snap.scheme);
    } else {
      console.warn("No scheme in snapshot, keeping current scheme");
    }

    const wasAuto = snap.weightMode === "auto";
    console.log("Weight mode:", snap.weightMode, "wasAuto:", wasAuto);
    setUseAutoWeights(wasAuto);
    if (wasAuto) {
      const o = {};
      (snap.rows || []).forEach((r) => { if (r?.source) o[r.source] = Number(r.weight) || 0; });
      setAutoWeightsOverride(o);
      console.log("Set auto weights override:", o);
    } else {
      setAutoWeightsOverride(null);
    }
  }

  // === Backup & Restore helpers ===
  function handleUploadDataWrapper(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const uploadedData = JSON.parse(event.target.result);

        if (!Array.isArray(uploadedData)) {
          console.error("Invalid file format. Expected JSON array.");
          return;
        }

        // Check if uploaded data has tab_sources_config
        const tabSourcesConfig = uploadedData.find(s => s.id === 'tab_sources_config');

        if (tabSourcesConfig && tabSourcesConfig.tabSources) {
          // Load complete tab structure from uploaded data
          setTabData(tabSourcesConfig.tabSources);

          // Save only the tab_sources_config to localStorage
          saveSnapshots([tabSourcesConfig]);

        } else {
          // No tab structure - treat as legacy data for KAUS tab

          const legacySnapshots = uploadedData.filter(s => s.id !== 'tab_sources_config');

          // Clean legacy snapshots by removing rows field (since rows are now in tabs)
          const cleanedSnapshots = legacySnapshots.map(snapshot => {
            const { rows, ...snapshotWithoutRows } = snapshot;
            return snapshotWithoutRows;
          });

          // Create new tab structure with KAUS containing the cleaned legacy snapshots
          const newTabData = {};
          tabs.forEach(tab => {
            newTabData[tab] = {
              rows: defaultRows.map((row, index) => ({ ...row, id: index + 1 })),
              snapshots: tab === 'KAUS' ? cleanedSnapshots : [] // Put cleaned legacy data in KAUS, others empty
            };
          });

          // Update tab data state
          setTabData(newTabData);
          const now = new Date();
          const localISOTime = now.toISOString();
          // Create tab_sources_config entry and save to localStorage
          const tabSourcesEntry = {
            id: 'tab_sources_config',
            savedAt: localISOTime,
            tabSources: newTabData,
          };

          // Save only the tab_sources_config to localStorage
          saveSnapshots([tabSourcesEntry]);

          // Switch to KAUS tab to show the loaded data
          setActiveTab('KAUS');
        }

        // Reset file input
        e.target.value = '';

      } catch (error) {
        console.error("Upload error:", error);
      }
    };

    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Forecast → Bracket Percentages</h1>
        <p className="text-sm text-gray-700 mb-4">Enter forecasts & weights. Save snapshots, attach actuals, use prior, and auto-learn bias.</p>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mb-[15px]">
          <div className="flex bg-gray-50">
            {tabs.map((tab, index) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-3 text-sm font-semibold text-center transition-all duration-200 relative group ${activeTab === tab
                  ? 'text-blue-700 bg-white shadow-sm border-b-2 border-blue-600 -mb-px z-10'
                  : 'text-gray-600 hover:text-blue-600 hover:bg-white/50'
                  } ${index === 0 ? 'rounded-tl-2xl' : ''} ${index === tabs.length - 1 ? 'rounded-tr-2xl' : ''}`}
              >
                <div className="relative z-10">
                  {tab}
                </div>
                {activeTab === tab && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-blue-500 to-blue-600"></div>
                )}
                {activeTab !== tab && (
                  <div className="absolute inset-x-0 bottom-0 h-px bg-gray-200 group-hover:bg-blue-200 transition-colors duration-200"></div>
                )}
              </button>
            )
            )}
          </div>
          <div className="px-4 py-2 bg-white border-t border-gray-100">
            <div className="text-xs text-gray-500 text-center">
              Current Location: <span className="font-medium text-gray-700">{activeTab}</span>
              <span className="mx-2">•</span>
              <span className="font-medium text-blue-600">
                {rows.filter(r => r.source.trim()).length} active source{rows.filter(r => r.source.trim()).length !== 1 ? 's' : ''}
              </span>
              <span className="mx-2">•</span>
              <span className="font-medium text-purple-600">
                {displaySnapshots.length} snapshot{displaySnapshots.length !== 1 ? 's' : ''}
              </span>
              {lastSaved && (
                <>
                  <span className="mx-2">•</span>
                  <span className="font-medium text-green-600">
                    Last Saved at {lastSaved}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          {/* LEFT COLUMN */}
          <div className="space-y-4">

            {/* Forecast table */}
            <div className="overflow-x-auto rounded-2xl shadow bg-white">
              <div className="px-3 pt-3 pb-1 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">Source Forecast (°F) Weight</div>
                  <div className="flex gap-2">
                    <button
                      onClick={addSource}
                      className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                      title="Add new source"
                    >
                      + Add Source
                    </button>
                  </div>
                </div>
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
                    <th className="p-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className={idx % 2 ? "bg-white" : "bg-gray-50"}>
                      <td className="p-2">
                        <input
                          className="w-full px-2 py-1 rounded border focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={r.source || ""}
                          onChange={(e) => updateSource(r.id, 'source', e.target.value)}
                          placeholder="Enter source name"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          className="w-24 text-right px-2 py-1 rounded border focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={r.forecast}
                          onChange={(e) => updateSource(r.id, 'forecast', Number(e.target.value))}
                          placeholder="0"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-24 text-right px-2 py-1 rounded border disabled:bg-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          value={useAutoWeights ? ((autoWeightsOverride?.[r.source] ?? autoWeightsMap?.[r.source] ?? 0).toFixed(3)) : r.weight}
                          onChange={(e) => updateSource(r.id, 'weight', Number(e.target.value))}
                          disabled={useAutoWeights}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => removeSource(r.id)}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                          title="Remove this source"
                          disabled={rows.length <= 1}
                        >
                          Remove
                        </button>
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
                <input className="flex-1 px-2 py-1 rounded border" value={saveName || ""} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g., 9-21-25 (early)" />
                <button onClick={handleSaveSnapshot} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">Save</button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Snapshots save inputs, brackets, and probabilities.</p>
            </div>

            {/* Attach actuals */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <h3 className="font-semibold mb-2">Final actual high → attach to saved</h3>
              <div className="flex flex-wrap gap-3 items-center mb-3">
                <label className="text-sm">Actual</label>
                <input type="number" className="w-24 text-right px-2 py-1 rounded border" value={actualInput || ""} onChange={(e) => setActualInput(e.target.value)} placeholder="e.g. 97" />
                <button className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200" onClick={handleAttachActualToSnapshots} disabled={!actualAttachIds.length || actualInput === ""}>Attach</button>
                <button className="px-3 py-1 rounded-2xl border shadow bg-rose-50 text-rose-700 hover:bg-rose-100" onClick={handleClearActualOnSnapshots} disabled={!actualAttachIds.length}>Clear on selected</button>
              </div>
              {displaySnapshots.length === 0 ? (
                <p className="text-sm text-gray-600">No saved forecasts yet.</p>
              ) : (
                <div className="max-h-48 overflow-auto rounded border p-2">
                  <ul className="space-y-1">
                    {displaySnapshots.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={actualAttachIds.includes(s.id)} onChange={() => setActualAttachIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])} />
                          <span className="font-medium">{s.name}</span>
                        </label>
                        <span className="text-xs text-gray-600">
                          {new Date(s.savedAt).toISOString()}
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
              {displaySnapshots.length === 0 ? (
                <p className="text-sm text-gray-600">No saved forecasts yet.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto">
                  <ul className="divide-y">
                    {displaySnapshots.map((s) => (
                      <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{s.name}</div>
                          <div className="text-xs text-gray-600">
                            {new Date(s.savedAt).toISOString()}
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
                <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleUploadDataWrapper} />
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1 rounded-2xl border shadow bg-gray-100 hover:bg-gray-200">Upload data (.json)</button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Exports/imports your saved forecasts, actuals, and settings for this tool.</p>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-4">
            {/* Tab-specific data header */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
              <div className="text-sm font-medium text-blue-800 text-center">
                📊 All data below is specific to <span className="font-bold">{activeTab}</span>
              </div>
              <div className="text-xs text-blue-600 text-center mt-1">
                Probabilities, accuracy, and statistics are calculated using only {activeTab} sources and snapshots
              </div>
            </div>

            {/* Bracket probabilities + editor */}
            <div className="p-4 rounded-2xl border shadow bg-white">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Implied bracket probabilities</h2>

                {showEditor ? (
                  <button onClick={() => { setShowEditor((v) => !v); updateCurrentTabDataScheme(); }} className="px-2 py-1 text-xs rounded border bg-gray-100 hover:bg-gray-200">Done</button>
                ) : (
                  <button onClick={() => setShowEditor((v) => !v)} className="px-2 py-1 text-xs rounded border bg-gray-100 hover:bg-gray-200">Edit</button>
                )}
              </div>
              <ul className="space-y-1">
                {tabScheme.map((b, i) => (
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
                      {tabScheme.map((b, idx) => (
                        <tr key={idx} className={idx % 2 ? "bg-white" : "bg-gray-50"}>
                          <td className="p-2"><input className="w-full px-2 py-1 rounded border" value={b.label || ""} onChange={(e) => setScheme((prev) => prev.map((bb, i) => i === idx ? { ...bb, label: e.target.value } : bb))} /></td>
                          <td className="p-2 text-right"><input type="number" className="w-20 text-right px-2 py-1 rounded border" value={b.max === Infinity ? "" : (b.max || "")} placeholder={b.max === Infinity ? "∞" : ""} onChange={(e) => setScheme((prev) => prev.map((bb, i) => i === idx ? { ...bb, max: e.target.value === "" ? Infinity : Number(e.target.value) } : bb))} /></td>
                          <td className="p-2 text-right"><button onClick={() => setScheme((prev) => prev.filter((_, i) => i !== idx))} className="px-2 py-1 rounded border bg-rose-50 text-rose-700 hover:bg-rose-100" disabled={tabScheme.length <= 1}>−</button></td>
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
              <select className="px-2 py-1 rounded border" disabled={!usePrior} value={priorId || ""} onChange={(e) => setPriorId(e.target.value)}>
                <option value="">Select saved forecast…</option>
                {displaySnapshots.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
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
                <input type="number" min={0} className="w-20 text-right px-2 py-1 rounded border" value={biasWindow} onChange={(e) => setBiasWindow(Math.max(0, Number(e.target.value) || 0))} />
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
                          <div className="text-[11px] text-gray-600 truncate">{new Date(s.savedAt).toISOString()}</div>
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
        {/* Kalshi Market Calculator */}
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Kalshi Market Calculator</h3>
          <div className="rounded-2xl border shadow bg-white p-4">
            <KalshiCalculator />
          </div>
        </div>
      </div>
    </div>
  );
}
