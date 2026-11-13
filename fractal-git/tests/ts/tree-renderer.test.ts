/**
 * Module: Terminal TUI Tree Renderer Test Suite
 * File Path: tests/ts/tree-renderer.test.ts
 * Architecture Role: Boundary and invariant verification for TUI ASCII and JSON tree visualizers.
 * Dependencies & Triggers: Node test runner; validates ts/tui/tree-renderer.ts.
 * Responsibilities: Prove cycle-breaking, empty-input handling, and deterministic output formatting.
 * Exit Semantics & Design Rationale: Exits cleanly when visualizer handles normal, nested, and malformed inputs.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    FRACTAL_TUI_FACADE_INFO,
    RenderNode,
    TreeRenderer,
} from '../../ts/tui/tree-renderer';

test('TreeRenderer: immutable facade descriptor contains expected subsystem info', () => {
    assert.equal(FRACTAL_TUI_FACADE_INFO.subsystem, 'fractal-git');
    assert.equal(FRACTAL_TUI_FACADE_INFO.tier, 'tui');
    assert.equal(Object.isFrozen(FRACTAL_TUI_FACADE_INFO), true);
});

test('TreeRenderer: safely handles null and empty inputs without throwing', () => {
    assert.equal(TreeRenderer.renderAscii(null), '');
    assert.equal(TreeRenderer.renderAscii(undefined), '');
    assert.equal(TreeRenderer.renderJson(null), '{}');
    assert.equal(TreeRenderer.renderJson(undefined), '{}');
});

test('TreeRenderer: renders clean ASCII tree and falls back for missing label', () => {
    const root: RenderNode = {
        id: 'node-root',
        label: 'WorkspaceRoot',
        status: 'active',
        children: [
            { id: 'node-c1', label: '', status: 'ok' },
            {
                id: 'node-c2',
                label: 'ChildTwo',
                status: '',
                children: [{ id: 'node-leaf', label: 'LeafNode', status: 'done' }],
            },
        ],
    };

    const ascii = TreeRenderer.renderAscii(root);
    assert.match(ascii, /WorkspaceRoot \[active\]/);
    assert.match(ascii, /node-c1 \[ok\]/);
    assert.match(ascii, /ChildTwo/);
    assert.match(ascii, /LeafNode \[done\]/);

    const json = TreeRenderer.renderJson(root);
    const parsed = JSON.parse(json);
    assert.equal(parsed.id, 'node-root');
    assert.equal(parsed.children.length, 2);
});

test('TreeRenderer: detects cycles and avoids infinite recursion', () => {
    const cyclicNode: RenderNode = {
        id: 'loop-node',
        label: 'LoopNode',
        status: 'pending',
        children: [],
    };
    cyclicNode.children = [cyclicNode];

    const ascii = TreeRenderer.renderAscii(cyclicNode);
    assert.match(ascii, /\[cycle detected\]/);
});
