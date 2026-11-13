/**
 * Module: Fractal Git — Terminal TUI Tree & DAG Renderer
 * File Path: ts/tui/tree-renderer.ts
 * Architecture Role: Dual-Faced visualizer: renders clean ASCII graph trees for human engineers
 *   and structured JSON models for autonomous AI agent inspection.
 * Dependencies & Triggers: Standalone presentation utility invoked by CLI diagnostics
 *   and TUI panels.
 * Responsibilities: Format hierarchical `RenderNode` DAG trees into deterministic box-drawing
 *   ASCII strings or pretty-printed JSON payloads with boundary protection against cycles and malformed inputs.
 * Exit Semantics & Design Rationale: Pure stateless rendering methods with zero side effects
 *   and fail-safe fallbacks on empty or malformed node structures.
 */

/**
 * Immutable facade metadata descriptor for the Fractal Git TUI visualizer.
 */
export const FRACTAL_TUI_FACADE_INFO = Object.freeze({
    subsystem: 'fractal-git',
    tier: 'tui',
    rendererVersion: '1.0.0',
});

/**
 * Maximum traversal depth to prevent stack overflow on deeply nested or cyclic DAG trees.
 */
const MAX_RENDER_DEPTH = 64;

/**
 * Hierarchical tree node representation for ASCII and structural rendering.
 */
export interface RenderNode {
    id: string;
    label: string;
    status: string;
    children?: RenderNode[];
}

/**
 * Formats a single node's label and status badge with cycle detection.
 *
 * @param node - The node to format.
 * @param visited - Set of observed node IDs.
 * @returns Formatted label string and whether a cycle was detected.
 */
function formatNodeHeader(node: RenderNode, visited: Set<string>): { header: string; isCycle: boolean } {
    const nodeId = typeof node.id === 'string' ? node.id : '';
    const nodeLabel = typeof node.label === 'string' && node.label.length > 0
        ? node.label
        : nodeId || '(unlabeled)';

    if (nodeId && visited.has(nodeId)) {
        return { header: `${nodeLabel} [cycle detected]`, isCycle: true };
    }
    if (nodeId) {
        visited.add(nodeId);
    }

    const statusText = typeof node.status === 'string' && node.status.trim().length > 0
        ? ` [${node.status.trim()}]`
        : '';
    return { header: `${nodeLabel}${statusText}`, isCycle: false };
}

/**
 * Extracts and filters children from a RenderNode safely.
 *
 * @param node - The target node.
 * @returns Array of valid child RenderNodes.
 */
function extractChildren(node: RenderNode): RenderNode[] {
    if (!Array.isArray(node.children)) {
        return [];
    }
    return node.children.filter((child): child is RenderNode => Boolean(child && typeof child === 'object'));
}

/**
 * Terminal UI tree renderer producing structured visual representations of DAG nodes.
 */
export class TreeRenderer {
    /**
     * Renders a hierarchical tree into a deterministic ASCII tree representation.
     *
     * @param node - Root node to format. Safe against null, undefined, or missing fields.
     * @param prefix - Indentation prefix for child rows (defaults to empty string).
     * @param visited - Set of observed node IDs used to break cyclic graph loops.
     * @param depth - Current recursion depth bounded by {@link MAX_RENDER_DEPTH}.
     * @returns Deterministic multi-line ASCII box-drawing tree representation.
     */
    public static renderAscii(
        node?: RenderNode | null,
        prefix = '',
        visited = new Set<string>(),
        depth = 0,
    ): string {
        if (!node || typeof node !== 'object') {
            return '';
        }
        if (depth > MAX_RENDER_DEPTH) {
            return `${prefix}└── [maximum tree depth exceeded]\n`;
        }

        const { header, isCycle } = formatNodeHeader(node, visited);
        let result = `${prefix}└── ${header}\n`;
        if (isCycle) {
            return result;
        }

        const children = extractChildren(node);
        for (let i = 0; i < children.length; i++) {
            const isLast = i === children.length - 1;
            const childPrefix = prefix + (isLast ? '    ' : '│   ');
            result += this.renderAscii(children[i], childPrefix, visited, depth + 1);
        }

        return result;
    }

    /**
     * Renders the node tree into dual-faced JSON for machine and agent inspection.
     *
     * @param node - Target node to serialize.
     * @returns Pretty-printed JSON string (or `{}` if target is empty).
     */
    public static renderJson(node?: RenderNode | null): string {
        if (!node || typeof node !== 'object') {
            return '{}';
        }
        try {
            return JSON.stringify(node, null, 2);
        } catch {
            return JSON.stringify({ id: String(node.id ?? ''), label: String(node.label ?? ''), error: 'serialization_failed' }, null, 2);
        }
    }
}
