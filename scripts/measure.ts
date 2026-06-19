/**
 * Measurement script for the paper.
 * Imports the pathfinding logic directly (no HTTP server) and runs the
 * four preset endpoint pairs at K=60 (Tables III/IV/V) plus a K-sweep
 * for Einstein->Plato (Figure 3).
 *
 * Run:  npx tsx scripts/measure.ts
 *
 * Writes incremental results to scripts/results.json so partial progress
 * survives a timeout.
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPersonGraph,
  buildAdjacency,
  type PersonGraph,
} from "../app/api/fetchDataWiki";
import { aStarSearch } from "../app/api/AStarSearch";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(SCRIPT_DIR, "results.json");

// ---------------------------------------------------------------------------
// Endpoint pairs (paper presets)
// ---------------------------------------------------------------------------
const PRESETS = [
  { label: "Einstein -> Plato", startId: "Q937", endId: "Q859", start: "Albert Einstein", end: "Plato" },
  { label: "Newton -> Aristotle", startId: "Q935", endId: "Q868", start: "Isaac Newton", end: "Aristotle" },
  { label: "Napoleon -> Caesar", startId: "Q517", endId: "Q1048", start: "Napoleon", end: "Julius Caesar" },
  { label: "Darwin -> Galileo", startId: "Q1035", endId: "Q307", start: "Charles Darwin", end: "Galileo Galilei" },
];

const K_SWEEP = [20, 40, 60, 80, 100];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadResults(): Record<string, unknown> {
  if (existsSync(RESULTS_PATH)) {
    try {
      return JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveResults(data: Record<string, unknown>): void {
  writeFileSync(RESULTS_PATH, JSON.stringify(data, null, 2));
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RunResult {
  found: boolean;
  hops: number;
  nodes: number;
  edges: number;
  buildMs: number;
  searchMs: number;
  path: { id: string; name: string; birthYear?: number; deathYear?: number }[];
  steps: { from: string; to: string; relation: string; property?: string; reversed: boolean }[];
}

/**
 * Run one full query: use given Q-IDs -> build graph -> A* search.
 * Mirrors what the tRPC `findPath` procedure does, minus the HTTP layer.
 */
async function runQuery(
  startId: string,
  endId: string,
  perOccupation: number,
): Promise<RunResult> {
  log(`  using Q-IDs: start=${startId}, end=${endId}`);

  // 1. Build graph with force-included endpoints.
  const buildStart = Date.now();
  const graph: PersonGraph = await buildPersonGraph({
    perOccupation,
    includeIds: [startId, endId],
    lang: "en",
    timeoutMs: 120_000,
    concurrency: 2,
  });
  const buildMs = Date.now() - buildStart;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const startNode = nodeById.get(startId);
  const endNode = nodeById.get(endId);
  if (!startNode || !endNode) {
    throw new Error("Endpoint missing from graph after build");
  }

  // 2. A* search.
  const adjacency = buildAdjacency(graph);
  const searchStart = Date.now();
  const pathIds = aStarSearch(graph, adjacency, startNode.id, endNode.id);
  const searchMs = Date.now() - searchStart;

  // 3. Resolve path + steps.
  const path = (pathIds ?? []).map((id) => {
    const n = nodeById.get(id)!;
    return {
      id: n.id,
      name: n.name,
      birthYear: n.birthYear,
      deathYear: n.deathYear,
    };
  });

  const steps = path.slice(0, -1).map((from, i) => {
    const to = path[i + 1];
    const forward = graph.edges.find(
      (e) => e.source === from.id && e.target === to.id,
    );
    const edge =
      forward ??
      graph.edges.find((e) => e.source === to.id && e.target === from.id);
    return {
      from: from.id,
      to: to.id,
      relation: edge?.relation ?? "connected to",
      property: edge?.property,
      reversed: edge ? !forward : false,
    };
  });

  return {
    found: pathIds !== null,
    hops: path.length > 0 ? path.length - 1 : 0,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    buildMs,
    searchMs,
    path,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const results = loadResults();
  log("=== Pathfinder measurement script ===");

  // --- Part 1: K=60 for all 4 presets (Tables III, IV, V) ---
  if (!results["presets_k60"]) results["presets_k60"] = {};
  saveResults(results);
  for (const p of PRESETS) {
    const key = p.label;
    const existing = (results["presets_k60"] as Record<string, unknown>)[key];
    if (existing && !(existing as { error?: string }).error) {
      log(`Preset @ K=60: ${p.label} -- already collected, skipping`);
      continue;
    }
    log(`Preset @ K=60: ${p.label}`);
    try {
      const r = await runQuery(p.startId, p.endId, 60);
      (results["presets_k60"] as Record<string, RunResult>)[key] = r;
      saveResults(results);
      log(
        `  done: found=${r.found} hops=${r.hops} nodes=${r.nodes} edges=${r.edges} build=${(r.buildMs / 1000).toFixed(1)}s search=${r.searchMs}ms`,
      );
    } catch (err) {
      log(`  ERROR: ${(err as Error).message}`);
      (results["presets_k60"] as Record<string, { error: string }>)[key] = {
        error: (err as Error).message,
      };
      saveResults(results);
    }
    // Cooldown between preset queries to avoid WDQS 429.
    log("  cooldown 20s...");
    await sleep(20_000);
  }

  // --- Part 2: K-sweep for Einstein->Plato (Figure 3) ---
  if (!results["k_sweep"]) results["k_sweep"] = {};
  saveResults(results);
  for (const k of K_SWEEP) {
    const key = `k${k}`;
    const existing = (results["k_sweep"] as Record<string, unknown>)[key];
    if (existing && !(existing as { error?: string }).error) {
      log(`K-sweep k=${k} already done, skipping`);
      continue;
    }
      log(`K-sweep: Einstein -> Plato @ K=${k}`);
      try {
        const r = await runQuery("Q937", "Q859", k);
        (results["k_sweep"] as Record<string, RunResult>)[key] = r;
        saveResults(results);
        log(
          `  done: nodes=${r.nodes} edges=${r.edges} build=${(r.buildMs / 1000).toFixed(1)}s search=${r.searchMs}ms hops=${r.hops}`,
        );
      } catch (err) {
        log(`  ERROR: ${(err as Error).message}`);
        (results["k_sweep"] as Record<string, { error: string }>)[key] = {
          error: (err as Error).message,
        };
        saveResults(results);
      }
      // Cooldown between K-sweep queries to avoid WDQS 429.
      log("  cooldown 20s...");
      await sleep(20_000);
    }

  log("=== DONE ===");
  log(`Results written to ${RESULTS_PATH}`);
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
