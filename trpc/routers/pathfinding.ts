import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { aStarSearch } from "@/app/api/AStarSearch";
import {
  buildAdjacency,
  buildPersonGraph,
  resolvePersonId,
  type PersonNode,
} from "@/app/api/fetchDataWiki";
import { baseProcedure, createTRPCRouter } from "../init";

const QID_RE = /^Q\d+$/;

const findPathInput = z.object({
  start: z.string().trim().min(1),
  end: z.string().trim().min(1),
  /** Occupation QIDs (P106) to seed the node set. Defaults applied downstream. */
  occupations: z.array(z.string().regex(QID_RE)).optional(),
  /** Top-K popular people per occupation. Higher = denser graph, slower fetch. */
  perOccupation: z.number().int().min(1).max(1000).optional(),
  /** Label / search language for the fetched nodes. */
  lang: z
    .string()
    .regex(/^[A-Za-z-]{2,15}$/)
    .optional(),
});

/** A resolved endpoint: the QID plus the label we matched it to (if by name). */
interface ResolvedEndpoint {
  id: string;
  matchedLabel?: string;
}

/**
 * Turn a QID-or-name token into a QID. A QID is used as-is; a name is looked
 * up via Wikidata entity search and the top hit is taken.
 */
async function resolveEndpoint(
  token: string,
  lang: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ResolvedEndpoint | null> {
  if (QID_RE.test(token)) return { id: token };
  const hit = await resolvePersonId(token, { lang, signal });
  return hit ? { id: hit.id, matchedLabel: hit.label } : null;
}

export const pathfindingRouter = createTRPCRouter({
  /**
   * Find a spatiotemporal A* path between two people.
   *
   * Pipeline: resolve both names -> QIDs -> fetch a self-contained subgraph
   * (forcing both endpoints in) -> run A* over the undirected adjacency ->
   * return the resolved path plus the relation taken at each hop.
   */
  findPath: baseProcedure.input(findPathInput).query(async ({ input, signal }) => {
    // 1. Resolve typed names to QIDs up front.
    const [startResolved, endResolved] = await Promise.all([
      resolveEndpoint(input.start, input.lang, signal),
      resolveEndpoint(input.end, input.lang, signal),
    ]);

    if (!startResolved) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No Wikidata entity matches the start person "${input.start}". Check the spelling.`,
      });
    }
    if (!endResolved) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No Wikidata entity matches the end person "${input.end}". Check the spelling.`,
      });
    }

    // 2. Build the subgraph with both endpoints guaranteed present.
    const buildStart = Date.now();
    const graph = await buildPersonGraph({
      occupations: input.occupations,
      perOccupation: input.perOccupation,
      includeIds: [startResolved.id, endResolved.id],
      lang: input.lang,
      signal,
    });
    const buildMs = Date.now() - buildStart;

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const startNode = nodeById.get(startResolved.id);
    const endNode = nodeById.get(endResolved.id);

    // Force-included, so these should always exist; guard for safety.
    if (!startNode || !endNode) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Resolved endpoint missing from the fetched graph.",
      });
    }

    // 3. Build adjacency list.
    const adjacency = buildAdjacency(graph);

    const searchStart = Date.now();
    const pathIds = aStarSearch(graph, adjacency, startNode.id, endNode.id);
    const searchMs = Date.now() - searchStart;

    // 4. Resolve the id path back to full nodes.
    const path: PersonNode[] = [];
    for (const id of pathIds ?? []) {
      const node = nodeById.get(id);
      if (node) path.push(node);
    }

    // 5. Annotate each hop with the interpersonal relation that connects it
    //    (the edge may be stored in either direction bcs the graph is undirected).
    const steps = path.slice(0, -1).map((from, i) => {
      const to = path[i + 1];
      const forward = graph.edges.find((e) => e.source === from.id && e.target === to.id);
      const edge =
        forward ?? graph.edges.find((e) => e.source === to.id && e.target === from.id);
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
      start: startNode,
      end: endNode,
      path,
      steps,
      hops: path.length > 0 ? path.length - 1 : 0,
      stats: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        buildMs,
        searchMs,
      },
    };
  }),
});
