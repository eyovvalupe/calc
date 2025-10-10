// ===== CONSTANTS AND TYPE DEFINITIONS =====

export const STORAGE_KEY = "kaus_snapshots_v2";

export const defaultScheme = [
  { label: "≤91", max: 91 },
  { label: "92–93", max: 93 },
  { label: "94–95", max: 95 },
  { label: "96–97", max: 97 },
  { label: "98–99", max: 99 },
  { label: "100+", max: Infinity },
];

export const defaultMarketOptions = [
  { id: '68_below', range: 'Range1', yesPrice: 0.01 },
  { id: '69_70', range: 'Range2', yesPrice: 0.01 },
  { id: '71_72', range: 'Range3', yesPrice: 0.26 },
  { id: '73_74', range: 'Range4', yesPrice: 0.58 },
  { id: '75_76', range: 'Range5', yesPrice: 0.16 },
  { id: '77_above', range: 'Range6', yesPrice: 0.08 },
];

export const defaultRows = [
  { id: 1, source: "CBS Austin", forecast: 97, weight: 0.25 },
  { id: 2, source: "KXAN", forecast: 96, weight: 0.2 },
  { id: 3, source: "FOX", forecast: 96, weight: 0.2 },
  { id: 4, source: "KVUE", forecast: 95, weight: 0.15 },
  { id: 5, source: "WU", forecast: 95, weight: 0.0667 },
  { id: 6, source: "NWS", forecast: 96, weight: 0.0667 },
  { id: 7, source: "AW", forecast: 96, weight: 0.0667 },
];
