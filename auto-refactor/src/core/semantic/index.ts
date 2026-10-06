/**
 * Module: Core Engine — Semantic Graph Subsystem Index & Substantive Facade
 * File Path: src/core/semantic/index.ts
 * Architecture Role: Central facade for the language-agnostic semantic IR and graph engine;
 *   re-exports semantic topology models, validates semantic nodes, and guarantees immutability.
 * Dependencies & Triggers: Re-exports ./types, ./semanticGraph, and ../ast/adapters.
 * Responsibilities:
 *   1. Single point of export for semantic topology models;
 *   2. Validate runtime shapes of SemanticNode instances;
 *   3. Enforce immutability on NodeCoordinate records via Object.freeze.
 * Exit Semantics & Design Rationale: Clean defensive validation throwing TypeError
 *   on invalid input; Object.freeze immutability prevents coordinate tampering.
 */

import type { NodeCoordinate, SemanticNode } from './types';

export * from './types';
export * from './semanticGraph';
export * from '../ast/adapters';

/**
 * Asserts that the supplied candidate object satisfies the SemanticNode contract.
 *
 * @param node - Candidate semantic node to validate.
 * @throws TypeError if node is not an object or lacks required attributes.
 */
export function assertValidSemanticNode(node: unknown): asserts node is SemanticNode {
    if (!node || typeof node !== 'object') {
        throw new TypeError('SemanticNode must be a non-null object');
    }
    const candidate = node as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
        throw new TypeError('SemanticNode.id must be a non-empty string');
    }
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
        throw new TypeError('SemanticNode.name must be a non-empty string');
    }
    if (typeof candidate.kind !== 'string' || candidate.kind.length === 0) {
        throw new TypeError('SemanticNode.kind must be a non-empty string');
    }
}

/**
 * Freezes a NodeCoordinate instance to ensure immutable source coordinates.
 *
 * @param coord - Mutable node coordinate.
 * @returns Frozen NodeCoordinate instance.
 */
export function freezeSemanticCoordinate(coord: NodeCoordinate): Readonly<NodeCoordinate> {
    if (!coord || typeof coord !== 'object') {
        throw new TypeError('NodeCoordinate must be a non-null object');
    }
    return Object.freeze({ ...coord });
}

/**
 * Creates an immutable default NodeCoordinate record.
 *
 * @param line - 1-indexed source line number.
 * @param column - 1-indexed source column number.
 * @returns Frozen NodeCoordinate instance.
 */
export function createDefaultNodeCoordinate(
    line: number = 1,
    column: number = 1,
): Readonly<NodeCoordinate> {
    return Object.freeze({ line, column });
}
