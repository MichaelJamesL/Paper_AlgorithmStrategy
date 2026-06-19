import { PersonGraph, PersonNode } from "./fetchDataWiki";

/**
 * Spatiotemporal heuristic h(n, t): Manhattan sum over birthplace lat/lon and
 * birth/death year differences. Estimates the remaining cost toward the target.
 */
export function heuristic(node: PersonNode, endNode: PersonNode): number {
    // Manhattan distance heuristic based on birth and death location + year
    const latDiff = Math.abs((node.lat || 0) - (endNode.lat || 0));
    const lonDiff = Math.abs((node.lon || 0) - (endNode.lon || 0));
    const birthYearDiff = Math.abs((node.birthYear || 0) - (endNode.birthYear || 0));
    const deathYearDiff = Math.abs((node.deathYear || 0) - (endNode.deathYear || 0));
    return latDiff + lonDiff + birthYearDiff + deathYearDiff;
}

/** Binary min-heap keyed by f-score: the A* open set / priority queue. */
class MinHeap {
    private items: { id: string; f: number }[] = [];

    get size(): number {
        return this.items.length;
    }

    push(id: string, f: number): void {
        const items = this.items;
        items.push({ id, f });
        // Shift up to restore the heap order.
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (items[parent].f <= items[i].f) break;
            [items[parent], items[i]] = [items[i], items[parent]];
            i = parent;
        }
    }

    pop(): string {
        const items = this.items;
        const top = items[0];
        const last = items.pop()!;
        if (items.length > 0) {
            // Move the last item to the root and shift it down.
            items[0] = last;
            let i = 0;
            for (;;) {
                const left = 2 * i + 1;
                const right = 2 * i + 2;
                let smallest = i;
                if (left < items.length && items[left].f < items[smallest].f) smallest = left;
                if (right < items.length && items[right].f < items[smallest].f) smallest = right;
                if (smallest === i) break;
                [items[smallest], items[i]] = [items[i], items[smallest]];
                i = smallest;
            }
        }
        return top.id;
    }
}

/** Walk the predecessor map back to the start to build the path in forward order. */
function reconstructPath(cameFrom: Map<string, string>, current: string): string[] {
    const path = [current];
    while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.push(current);
    }
    return path.reverse();
}

/**
 * A* search with f(n) = g(n) + h(n) and unit edge cost.
 * Expands the open node with the smallest f, relaxes each neighbour's g, and
 * reconstructs the path via cameFrom. Optimal when the heuristic is admissible.
 */
export function aStarSearch(graph: PersonGraph, adjacencyList: Map<string, Set<string>>, startId: string, endId: string): string[] | null {
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const startNode = nodeById.get(startId);
    const endNode = nodeById.get(endId);
    if (!startNode || !endNode) {
        return null; // Start or end node not found
    }

    if (startId === endId) {
        return [startId]; // Start and end are the same
    }

    if (startNode.sitelinks < 5 || endNode.sitelinks < 5) {
        return null; // Not enough sitelinks to consider
    }

    const gScore = new Map<string, number>([[startId, 0]]); // best cost-so-far per node (Infinity if unseen)
    const cameFrom = new Map<string, string>();
    const closed = new Set<string>();
    const open = new MinHeap();
    open.push(startId, heuristic(startNode, endNode));

    while (open.size > 0) {
        const currentId = open.pop(); // node with the smallest f
        if (currentId === endId) {
            return reconstructPath(cameFrom, currentId);
        }
        if (closed.has(currentId)) continue; // stale duplicate left over from a worse f
        closed.add(currentId);

        const g = gScore.get(currentId)!;
        for (const neighborId of adjacencyList.get(currentId) ?? []) {
            if (closed.has(neighborId)) continue;
            if (!nodeById.has(neighborId)) continue;
            const tentativeG = g + 1; // unit edge cost
            if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
                // Found a cheaper path to neighbor: relax g and requeue it.
                cameFrom.set(neighborId, currentId);
                gScore.set(neighborId, tentativeG);
                open.push(neighborId, tentativeG + heuristic(nodeById.get(neighborId)!, endNode));
            }
        }
    }

    return null; // Open set exhausted: no path exists
}
