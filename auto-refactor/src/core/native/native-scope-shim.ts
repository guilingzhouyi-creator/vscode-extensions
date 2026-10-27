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
        const parentId = scopes[i].parent;
        parentMap.set(i, typeof parentId === 'number' && parentId >= 0 ? parentId : null);
    }

    const bindingsByScope = new Map<number, Map<string, NativeBindingInput>>();
    for (let i = 0; i < bindings.length; i++) {
        const bindingItem = bindings[i];
        const scopeMap = getOrCreateScopeMap(bindingsByScope, bindingItem.scopeId);
        if (!scopeMap.has(bindingItem.name)) {
            scopeMap.set(bindingItem.name, bindingItem);
        }
    }

    const defects: NativeShadowingResult[] = [];
    for (let i = 0; i < bindings.length; i++) {
        const bindingItem = bindings[i];
        let curr = parentMap.get(bindingItem.scopeId);
        while (curr !== null && curr !== undefined) {
            const outer = bindingsByScope.get(curr)?.get(bindingItem.name);
            if (outer) {
                defects.push({
                    symbol: bindingItem.name,
                    innerScopeId: bindingItem.scopeId,
                    innerLine: bindingItem.line,
                    outerScopeId: outer.scopeId,
                    outerLine: outer.line,
                    bindingKind: bindingItem.kind,
                });
            }
            curr = parentMap.get(curr);
        }
    }
    return defects;
}
