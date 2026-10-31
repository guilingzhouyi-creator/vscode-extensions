/**
 * Module: Fractal Git — Terminal TUI Tree & DAG Renderer
 * File Path: ts/tui/tree-renderer.ts
 * Architecture Role: Dual-Faced visualizer: renders clean ASCII graph trees for human engineers
 *   and structured JSON models for autonomous AI agent inspection.
 * Dependencies & Triggers: Standalone presentation utility invoked by CLI diagnostics
 *   and TUI panels.
 * Responsibilities: Format hierarchical `RenderNode` DAG trees into deterministic box-drawing
 *   ASCII strings or pretty-printed JSON payloads.
 * Exit Semantics & Design Rationale: Pure stateless rendering methods with zero side effects.
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
 * Hierarchical tree node representation for ASCII and structural rendering.
 */
export interface RenderNode {
    id: string;
    label: string;
    status: string;
    children?: RenderNode[];
}

/**
 * Terminal UI tree renderer producing structured visual representations of DAG nodes.
 */
export class TreeRenderer {
    /**
     * Renders a hierarchical tree into an ASCII representation.
     */
    public static renderAscii(node: RenderNode, prefix = ''): string {
        const statusTag = node.status ? ` [${node.status}]` : '';
        let result = `${prefix}└── ${node.label}${statusTag}\n`;
        const children = node.children || [];
        for (let i = 0; i < children.length; i++) {
            const childPrefix = prefix + (i === children.length - 1 ? '    ' : '│   ');
            result += this.renderAscii(children[i], childPrefix);
        }
        return result;
    }

    /**
     * Renders the node tree into dual-faced JSON for machine ingestion.
     */
    public static renderJson(node: RenderNode): string {
        return JSON.stringify(node, null, 2);
    }
}
