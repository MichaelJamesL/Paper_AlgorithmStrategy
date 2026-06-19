/**
 * fetchDataWiki build the data layer sourced from the Wikidata Query Service (WDQS).
 * WDQS endpoint: https://query.wikidata.org/sparql
 * Docs: https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service
 */

const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
/** The MediaWiki action API — used for name -> QID search (wbsearchentities). */
const WIKIDATA_API_ENDPOINT = "https://www.wikidata.org/w/api.php";
const USER_AGENT = "makalah-stima (educational project; contact: jamesliman7@gmail.com)";

/**
 * The edge vocabulary
 */
export const INTERPERSONAL_RELATIONS: Record<string, string> = {
  P737: "influenced by",
  P1066: "student of",
  P802: "student",
  P184: "doctoral advisor",
  P185: "doctoral student",
  P22: "father",
  P25: "mother",
  P40: "child",
  P3373: "sibling",
  P26: "spouse",
  P451: "partner",
};

/**
 * Default occupations (Wikidata P106 QIDs) used to seed the node set, chosen to
 * span domains so two arbitrary "popular people" have a chance of connecting.
 */
export const DEFAULT_OCCUPATIONS: string[] = [
  "Q901", // scientist
  "Q170790", // mathematician
  "Q4964182", // philosopher
  "Q82955", // politician
  "Q116", // monarch
  "Q47064", // military personnel
  "Q36180", // writer
  "Q1028181", // painter
  "Q33999", // actor
  "Q2526255", // film director
  "Q177220", // singer
  "Q639669", // musician
];

/** A graph node: a person with the space + time coordinates. */
export interface PersonNode {
  /** Wikidata entity id, e.g. "Q937". */
  id: string;
  /** Human-readable label in the requested language. */
  name: string;
  /** Short Wikidata description, if available. */
  description?: string;
  /** TIME coordinate: year of birth (negative for BCE). */
  birthYear?: number;
  /** TIME coordinate: year of death (negative for BCE; absent if living). */
  deathYear?: number;
  /** SPACE coordinate: latitude of place of birth. */
  lat?: number;
  /** SPACE coordinate: longitude of place of birth. */
  lon?: number;
  /** Country of citizenship (label). */
  country?: string;
  /** Sitelink count, means popularity proxy and tie-breaker. */
  sitelinks: number;
  /** Wikimedia Commons image URL, if available. */
  imageUrl?: string;
}

/** A directed interpersonal relationship between two nodes. */
export interface RelationEdge {
  /** Subject QID. */
  source: string;
  /** Object QID. */
  target: string;
  /** Wikidata property id, e.g. "P737". */
  property: string;
  /** Human-readable relation name, e.g. "influenced by". */
  relation: string;
}

/** A self-contained graph ready for offline pathfinding. */
export interface PersonGraph {
  nodes: PersonNode[];
  edges: RelationEdge[];
}

/** A name-search hit from the Wikidata entity-search API. */
export interface PersonSearchResult {
  /** Wikidata QID, e.g. "Q937". */
  id: string;
  /** Matched entity label, e.g. "Albert Einstein". */
  label: string;
  /** Short description, e.g. "German-born theoretical physicist". */
  description?: string;
}

export interface BuildPersonGraphOptions {
  /** Occupation QIDs (P106) to seed nodes from. Default {@link DEFAULT_OCCUPATIONS}. */
  occupations?: string[];
  /** Top-K most popular people to take per occupation. Default 60. */
  perOccupation?: number;
  /** Force-include these QIDs as nodes (e.g. your two endpoints). Default none. */
  includeIds?: string[];
  /** Relation property ids to use as edges. Default keys of {@link INTERPERSONAL_RELATIONS}. */
  relations?: string[];
  /** Label/description language code. Default "en". */
  lang?: string;
  /** Override the SPARQL endpoint (useful for tests/mirrors). */
  endpoint?: string;
  /** Abort a single request after this many ms. Default 60000 (the WDQS limit). */
  timeoutMs?: number;
  /** Max concurrent requests to WDQS.*/
  concurrency?: number;
  /** Optional external abort signal; combined with the per-request timeout. */
  signal?: AbortSignal;
}

/** Shape of a single value inside a SPARQL JSON binding. */
interface SparqlValue {
  type: string;
  value: string;
  "xml:lang"?: string;
  datatype?: string;
}

type SparqlRow = Record<string, SparqlValue | undefined>;

/** Minimal shape of the WDQS JSON response. */
interface SparqlResponse {
  results?: { bindings?: SparqlRow[] };
}

const QID_RE = /^Q\d+$/;
const PID_RE = /^P\d+$/;
const LANG_RE = /^[A-Za-z-]{2,15}$/;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Run a SPARQL query against WDQS (POST, with timeout + abort + UA). */
async function runSparql(
  query: string,
  opts: { endpoint: string; timeoutMs: number; signal?: AbortSignal },
): Promise<SparqlResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  const onExternalAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onExternalAbort);

  let response: Response;
  try {
    response = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ query }).toString(),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Wikidata SPARQL request timed out after ${opts.timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Wikidata SPARQL request failed: ${response.status} ${response.statusText}` +
        (body ? `\n${body.slice(0, 500)}` : ""),
    );
  }
  return (await response.json()) as SparqlResponse;
}

/** Run fn over items with at most limit promises in flight. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

/** Split an array into fixed-size chunks. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Extract the trailing QID/PID from an entity/property URI. */
function localName(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

/** Parse a Wikidata date literal into a year. */
function yearFromISO(value?: string): number | undefined {
  if (!value) return undefined;
  const m = /^(-?\d+)-/.exec(value);
  if (!m) return undefined;
  const year = Number(m[1]);
  return Number.isFinite(year) ? year : undefined;
}

/** Parse a WKT point literal "Point(lon lat)" into { lat, lon }. */
function parsePoint(value?: string): { lat: number; lon: number } | undefined {
  if (!value) return undefined;
  const m = /Point\(([-\d.eE]+)\s+([-\d.eE]+)\)/.exec(value);
  if (!m) return undefined;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
}

// ---------------------------------------------------------------------------
// Node fetching
// ---------------------------------------------------------------------------

const NODE_SELECT =
  "SELECT ?person ?personLabel ?personDescription ?birth ?death ?coord ?countryLabel ?sitelinks ?image WHERE";
const NODE_OPTIONALS = `  OPTIONAL { ?person wdt:P569 ?birth. }
  OPTIONAL { ?person wdt:P570 ?death. }
  OPTIONAL { ?person wdt:P27 ?country. }
  OPTIONAL { ?person wdt:P19 ?birthPlace. ?birthPlace wdt:P625 ?coord. }
  OPTIONAL { ?person wdt:P18 ?image. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "LANG". }`;

/** Top-K most popular people for one occupation, enriched with attributes. */
function buildOccupationNodeQuery(occupation: string, limit: number, lang: string): string {
  return `${NODE_SELECT} {
  {
    SELECT ?person ?sitelinks WHERE {
      ?person wdt:P106 wd:${occupation} ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?sitelinks .
    }
    ORDER BY DESC(?sitelinks)
    LIMIT ${limit}
  }
${NODE_OPTIONALS.replace("LANG", lang)}
}`;
}

/** Attributes for an explicit list of people (force-included endpoints). */
function buildIdsNodeQuery(ids: string[], lang: string): string {
  const values = ids.map((id) => `wd:${id}`).join(" ");
  return `${NODE_SELECT} {
  VALUES ?person { ${values} }
  OPTIONAL { ?person wikibase:sitelinks ?sitelinks. }
${NODE_OPTIONALS.replace("LANG", lang)}
}`;
}

/** Merge a single SPARQL row into the node map, filling any missing fields. */
function addNodeRow(map: Map<string, PersonNode>, row: SparqlRow): void {
  const uri = row.person?.value;
  if (!uri) return;
  const id = localName(uri);

  let node = map.get(id);
  if (!node) {
    node = { id, name: id, sitelinks: 0 };
    map.set(id, node);
  }

  if (row.personLabel?.value && node.name === id) node.name = row.personLabel.value;
  if (!node.description && row.personDescription?.value) {
    node.description = row.personDescription.value;
  }
  if (node.birthYear === undefined) {
    const y = yearFromISO(row.birth?.value);
    if (y !== undefined) node.birthYear = y;
  }
  if (node.deathYear === undefined) {
    const y = yearFromISO(row.death?.value);
    if (y !== undefined) node.deathYear = y;
  }
  if (node.lat === undefined) {
    const c = parsePoint(row.coord?.value);
    if (c) {
      node.lat = c.lat;
      node.lon = c.lon;
    }
  }
  if (!node.country && row.countryLabel?.value && row.countryLabel.value !== localName(uri)) {
    node.country = row.countryLabel.value;
  }
  if (!node.imageUrl && row.image?.value) node.imageUrl = row.image.value;
  if (row.sitelinks?.value) {
    node.sitelinks = Math.max(node.sitelinks, Number(row.sitelinks.value));
  }
}

// ---------------------------------------------------------------------------
// Edge fetching
// ---------------------------------------------------------------------------

/** Interpersonal edges where ?a is in `sources` and ?b is in `targets`. */
function buildEdgeQuery(sources: string[], targets: string[], relations: string[]): string {
  const a = sources.map((id) => `wd:${id}`).join(" ");
  const b = targets.map((id) => `wd:${id}`).join(" ");
  const rel = relations.map((p) => `wdt:${p}`).join(" ");
  return `SELECT ?a ?rel ?b WHERE {
  VALUES ?a { ${a} }
  VALUES ?rel { ${rel} }
  ?a ?rel ?b .
  VALUES ?b { ${b} }
}`;
}

function edgeKey(e: RelationEdge): string {
  return `${e.source}|${e.property}|${e.target}`;
}

function parseEdgeRows(map: Map<string, RelationEdge>, rows: SparqlRow[]): void {
  for (const row of rows) {
    const source = row.a?.value ? localName(row.a.value) : undefined;
    const target = row.b?.value ? localName(row.b.value) : undefined;
    const property = row.rel?.value ? localName(row.rel.value) : undefined;
    if (!source || !target || !property || source === target) continue;
    const edge: RelationEdge = {
      source,
      target,
      property,
      relation: INTERPERSONAL_RELATIONS[property] ?? property,
    };
    map.set(edgeKey(edge), edge);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a self-contained person graph for spatiotemporal A* pathfinding.
 *
 * @example
 * // Two endpoints guaranteed present; A* runs on the returned graph.
 * const graph = await buildPersonGraph({
 *   includeIds: ["Q937", "Q859"], // Einstein, Plato
 *   perOccupation: 80,
 * });
 * const adjacency = buildAdjacency(graph); // Map<id, Set<neighborId>>
 */
export async function buildPersonGraph(
  options: BuildPersonGraphOptions = {},
): Promise<PersonGraph> {
  const {
    occupations = DEFAULT_OCCUPATIONS,
    perOccupation = 60,
    includeIds = [],
    relations = Object.keys(INTERPERSONAL_RELATIONS),
    lang = "en",
    endpoint = WIKIDATA_SPARQL_ENDPOINT,
    timeoutMs = 90_000,
    concurrency = 3,
    signal,
  } = options;

  // --- Validate everything interpolated into SPARQL ---
  for (const occ of occupations) {
    if (!QID_RE.test(occ)) throw new Error(`Invalid occupation QID: ${occ}`);
  }
  for (const id of includeIds) {
    if (!QID_RE.test(id)) throw new Error(`Invalid includeIds QID: ${id}`);
  }
  for (const rel of relations) {
    if (!PID_RE.test(rel)) throw new Error(`Invalid relation property id: ${rel}`);
  }
  if (!LANG_RE.test(lang)) throw new Error(`Invalid language code: ${lang}`);
  if (!Number.isInteger(perOccupation) || perOccupation < 1 || perOccupation > 1000) {
    throw new Error(`Invalid perOccupation: ${perOccupation} (expected 1..1000)`);
  }

  const runOpts = { endpoint, timeoutMs, signal };
  const nodeMap = new Map<string, PersonNode>();

  // 1. Top-K popular people per occupation (one fast query each).
  const occResponses = await mapLimit(occupations, concurrency, (occ) =>
    runSparql(buildOccupationNodeQuery(occ, perOccupation, lang), runOpts),
  );
  for (const resp of occResponses) {
    for (const row of resp.results?.bindings ?? []) addNodeRow(nodeMap, row);
  }

  // 2. Force-include explicit endpoints, so the two chosen people are present.
  if (includeIds.length > 0) {
    const resp = await runSparql(buildIdsNodeQuery(includeIds, lang), runOpts);
    for (const row of resp.results?.bindings ?? []) addNodeRow(nodeMap, row);
  }

  const ids = [...nodeMap.keys()];

  // 3. Interpersonal edges among the node set (chunk the ?a side).
  const edgeMap = new Map<string, RelationEdge>();
  if (ids.length > 0) {
    const sourceChunks = chunk(ids, 150);
    const edgeResponses = await mapLimit(sourceChunks, concurrency, (sources) =>
      runSparql(buildEdgeQuery(sources, ids, relations), runOpts),
    );
    for (const resp of edgeResponses) parseEdgeRows(edgeMap, resp.results?.bindings ?? []);
  }

  const nodes = [...nodeMap.values()].sort((x, y) => y.sitelinks - x.sitelinks);
  return { nodes, edges: [...edgeMap.values()] };
}

/**
 * Build an adjacency map for pathfinding.
 */
export function buildAdjacency(
  graph: PersonGraph,
  options: { undirected?: boolean } = {},
): Map<string, Set<string>> {
  const undirected = options.undirected ?? true;
  const adjacency = new Map<string, Set<string>>();
  const ensure = (id: string): Set<string> => {
    let set = adjacency.get(id);
    if (!set) {
      set = new Set<string>();
      adjacency.set(id, set);
    }
    return set;
  };

  for (const node of graph.nodes) ensure(node.id);
  for (const edge of graph.edges) {
    ensure(edge.source).add(edge.target);
    if (undirected) ensure(edge.target).add(edge.source);
  }
  return adjacency;
}

/** Look up a node by exact (then partial) case-insensitive name match. */
export function findPersonByName(graph: PersonGraph, name: string): PersonNode | undefined {
  const q = name.trim().toLowerCase();
  return (
    graph.nodes.find((n) => n.name.toLowerCase() === q) ??
    graph.nodes.find((n) => n.name.toLowerCase().includes(q))
  );
}

export interface SearchOptions {
  /** Search/result language code. Default "en". */
  lang?: string;
  /** Max results to return (1..50). Default 7. */
  limit?: number;
  /** Override the action-API endpoint. */
  endpoint?: string;
  /** Abort the request after this many ms. Default 15000. */
  timeoutMs?: number;
  /** Optional external abort signal. */
  signal?: AbortSignal;
}

/**
 * Search Wikidata for entities matching a name, via the wbsearchentities
 * action API. Returns ranked candidates (most relevant first). This converts
 * typed name like "Albert Einstein" becomes a QID like "Q937".
 *
 * SERVER-SIDE ONLY: sets a User-Agent header.
 */
export async function searchPersonByName(
  name: string,
  options: SearchOptions = {},
): Promise<PersonSearchResult[]> {
  const {
    lang = "en",
    limit = 7,
    endpoint = WIKIDATA_API_ENDPOINT,
    timeoutMs = 15_000,
    signal,
  } = options;
  if (!LANG_RE.test(lang)) throw new Error(`Invalid language code: ${lang}`);
  const trimmed = name.trim();
  if (!trimmed) return [];

  const params = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    language: lang,
    uselang: lang,
    type: "item",
    limit: String(Math.min(Math.max(Math.trunc(limit), 1), 50)),
    search: trimmed,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort);

  let response: Response;
  try {
    response = await fetch(`${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Wikidata API request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Wikidata API request failed: ${response.status} ${response.statusText}` +
        (body ? `\n${body.slice(0, 500)}` : ""),
    );
  }

  const data = (await response.json()) as {
    search?: { id?: string; label?: string; description?: string }[];
  };
  return (data.search ?? [])
    .filter((s): s is { id: string; label?: string; description?: string } =>
      typeof s.id === "string" && QID_RE.test(s.id),
    )
    .map((s) => ({ id: s.id, label: s.label ?? s.id, description: s.description }));
}

/**
 * Resolve a single name to the best-matching Wikidata entity (top search hit),
 * or null if nothing matches.
 */
export async function resolvePersonId(
  name: string,
  options: Omit<SearchOptions, "limit"> = {},
): Promise<PersonSearchResult | null> {
  const results = await searchPersonByName(name, { ...options, limit: 1 });
  return results[0] ?? null;
}

export default buildPersonGraph;
