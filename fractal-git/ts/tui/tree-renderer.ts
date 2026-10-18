/**
 * Module: Fractal Git — Terminal TUI Tree & DAG Renderer
 * File Path: ts/tui/tree-renderer.ts
 * Architecture Role: Dual-Faced visualizer: renders clean ASCII graph trees for human engineers
 *   and structured JSON models for autonomous AI agent inspection.
 */

export interface RenderNode {
    id: string;
    label: string;
    status: string;
    children?: RenderNode[];
}

export class TreeRenderer {
    /**
     * Renders a hierarchical tree into an ASCII representation.
     */
    public static renderAscii(node: RenderNode, prefix: string = ""): string {
        const statusTag = node.status ? ` [${node.status}]` : "";
        let result = `${prefix}└── ${node.label}${statusTag}\n`;
        const children = node.children || [];
        for (let i = 0; i < children.length; i++) {
            const childPrefix = prefix + (i === children.length - 1 ? "    " : "│   ");
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
