/**
 * Module: Core Engine - Native Scope & Shadowing Shim
 * File Path: src/core/native/native-scope-shim.ts
 * Architecture Role: Pure JavaScript fallback implementation of scope hierarchy analysis
 *   and variable shadowing detection, providing reference parity with the ops-scope Rust kernel.
 * Dependencies & Triggers: Consumes ./native-types; delegated by ./native-bridge.
 * Responsibilities:
 *   1. Analyze lexical scope parent-child chains;
 *   2. Detect variable/symbol shadowing incidents across nested scopes using fast
 *      O(B * D) map index;
 *   3. Deliver deterministic, 100% byte-equivalent results when compiled Rust core is absent.
 * Exit Semantics & Design Rationale: Dependency-free, fully deterministic pure JS shim.
 */

import type { NativeBindingInput, NativeScopeInput, NativeShadowingResult } from './native-types';

function getOrCreateScopeMap(
    bindingsByScope: Map<number, Map<string, NativeBindingInput>>,
    scopeId: number,
): Map<string, NativeBindingInput> {
    let scopeMap = bindingsByScope.get(scopeId);
    if (!scopeMap) {
        scopeMap = new Map();
        bindingsByScope.set(scopeId, scopeMap);
    }
    return scopeMap;
}

/**
 * Pure JS fallback analyzing variable scope hierarchy and discovering symbol shadowing.
 * Uses an inverted scope-to-binding index for O(B * D) lookup without deep loop nesting.
 *
 * @param scopes - Flat list of scope descriptors with parent indices.
 * @param bindings - Flat list of symbol bindings with scope IDs and line numbers.
 * @returns Array of detected variable shadowing incidents.
 */
export function analyzeScopeShadowingShim(
    scopes: readonly NativeScopeInput[],
    bindings: readonly NativeBindingInput[],
): NativeShadowingResult[] {
    const parentMap = new Map<number, number | null>();
    for (let i = 0; i < scopes.length; i++) {
        const p = scopes[i].parent;
        parentMap.set(i, typeof p === 'number' && p >= 0 ? p : null);
    }

    const bindingsByScope = new Map<number, Map<string, NativeBindingInput>>();
    for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        const scopeMap = getOrCreateScopeMap(bindingsByScope, b.scopeId);
        if (!scopeMap.has(b.name)) {
            scopeMap.set(b.name, b);
        }
    }

    const defects: NativeShadowingResult[] = [];
    for (let i = 0; i < bindings.length; i++) {
        const b = bindings[i];
        let curr = parentMap.get(b.scopeId);
        while (curr !== null && curr !== undefined) {
            const outer = bindingsByScope.get(curr)?.get(b.name);
            if (outer) {
                defects.push({
                    symbol: b.name,
                    innerScopeId: b.scopeId,
                    innerLine: b.line,
                    outerScopeId: outer.scopeId,
                    outerLine: outer.line,
                    bindingKind: b.kind,
                });
            }
            curr = parentMap.get(curr);
        }
    }
    return defects;
}
