import { PersonGraph, PersonNode } from "./fetchDataWiki";

/**
 * Calculates the heuristic value for a node based on its distance to the end node
 * @param node 
 * @param endNode 
 * @returns 
 */
export function heuristic(node: PersonNode, endNode: PersonNode): number {
    // Manhattan distance heuristic based on birth and death location + year
    const latDiff = Math.abs((node.lat || 0) - (endNode.lat || 0));
    const lonDiff = Math.abs((node.lon || 0) - (endNode.lon || 0));
    const birthYearDiff = Math.abs((node.birthYear || 0) - (endNode.birthYear || 0));
    const deathYearDiff = Math.abs((node.deathYear || 0) - (endNode.deathYear || 0));
    return latDiff + lonDiff + birthYearDiff + deathYearDiff;
}

/**
 * Recursively performs A* search on the graph
 * @param graph 
 * @param node 
 * @param endNode 
 * @param adjacencyList 
 * @param visited 
 * @param path 
 * @param g 
 * @returns 
 */
function recursiveAStar(graph: PersonGraph, node: PersonNode, endNode: PersonNode, adjacencyList: Map<string, Set<string>>, visited: Set<string>, path: string[], g: number): string[] | null {
    if (node.id === endNode.id) {
        return path;
    }
    visited.add(node.id);
    // buildAdjacency stores neighbors as a Set, copy into an array so we can sort by heuristic.
    const neighbors = [...(adjacencyList.get(node.id) ?? [])];
    neighbors.sort((a, b) => {
        const aNode = graph.nodes.find(n => n.id === a);
        const bNode = graph.nodes.find(n => n.id === b);
        if (!aNode || !bNode) return 0;
        return heuristic(aNode, endNode) - heuristic(bNode, endNode);
    });
    for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
            const neighborNode = graph.nodes.find(n => n.id === neighborId);
            if (neighborNode) {
                const result = recursiveAStar(graph, neighborNode, endNode, adjacencyList, visited, [...path, neighborId], g + 1);
                if (result) {
                    return result;
                }
            }
        }
    }
    visited.delete(node.id);
    return null;
}

/**
 * Performs A* search on the given graph to find a path from startId to endId
 * @param graph 
 * @param adjacencyList 
 * @param startId 
 * @param endId 
 * @returns 
 */
export function aStarSearch(graph: PersonGraph, adjacencyList: Map<string, Set<string>>, startId: string, endId: string): string[] | null {
    const startNode = graph.nodes.find(node => node.id === startId);
    const endNode = graph.nodes.find(node => node.id === endId);
    if (!startNode || !endNode) {
        return null; // Start or end node not found
    }

    if (startId === endId) {
        return [startId]; // Start and end are the same
    }

    if (startNode.sitelinks < 5 || endNode.sitelinks < 5) {
        return null; // Not enough sitelinks to consider
    }
    return recursiveAStar(graph, startNode, endNode, adjacencyList, new Set(), [startId], 0);
}