/**
 * Module: Unit Test — Fast-Path Lazy Projection Registry Integrity
 * File Path: tests/unit/fast-path-analyzers.test.ts
 * Architecture Role: Regression guard ensuring FAST_PATH_ANALYZERS contains strictly active
 *   built-in streaming analyzers supporting NodeProjector without stale or phantom IDs.
 * Dependencies & Triggers: Consumes FAST_PATH_ANALYZERS, tryCreateProjector, BUILTIN_ANALYZERS,
 *   and TypeScriptAdapter/OxcAdapter; executes in Vitest unit runs.
 * Responsibilities: Assert zero phantom analyzer IDs, complete alignment with active built-ins,
 *   and fast-path hit on default analyzer sets (plus fallback for legacy/custom analyzers).
 * Exit Semantics & Design Rationale: Fails immediately if phantom analyzer IDs reappear or default
 *   configs miss lazy projection.
 */
import { describe, expect, it } from 'vitest';
import { FAST_PATH_ANALYZERS, tryCreateProjector } from '../../src/core/ast/traverse';
import { BUILTIN_ANALYZERS } from '../../src/core/constants/rule-codes';
import { BUILTIN_FACTORIES } from '../../src/core/analyzer-registry';
import { TypeScriptAdapter } from '../../src/core/ast/typescript-adapter';
import { getDefaultConfig } from '../../src/core/config/config';

const PHANTOM_LEGACY_IDS = [
    'type-safety',
    'error-handling',
    'api-contracts',
    'test-quality',
    'security-pack',
    'i18n',
    'css-hygiene',
    'accessibility',
    'telemetry-observability',
    'domain-ddd',
    'nodejs-runtime',
    'react-ui',
    'python-pack',
    'rust-pack',
    'go-pack',
    'java-pack',
    'cpp-pack',
] as const;

describe('FAST_PATH_ANALYZERS active registry synchronization', () => {
    it('excludes all 17 phantom analyzer identifiers and matches active built-ins', () => {
        for (const phantomId of PHANTOM_LEGACY_IDS) {
            expect(FAST_PATH_ANALYZERS.has(phantomId)).toBe(false);
        }

        const expectedActive = new Set<string>(BUILTIN_ANALYZERS);
        expect(FAST_PATH_ANALYZERS.size).toBe(expectedActive.size);
        for (const id of expectedActive) {
            expect(FAST_PATH_ANALYZERS.has(id)).toBe(true);
            const instance = BUILTIN_FACTORIES[id]();
            const hooks = instance as { visit?: unknown; finalize?: unknown };
            expect(typeof hooks.visit === 'function' || typeof hooks.finalize === 'function').toBe(
                true,
            );
        }
    });

    it('hits lazy NodeProjector on default scan plans while still bypassing legacy analyzers', () => {
        const defaultConfig = getDefaultConfig();
        const enabledNames = Object.entries(defaultConfig.analyzers)
            .filter(([, decl]) => decl && decl.enabled !== false)
            .map(([name]) => name);

        const adapter = new TypeScriptAdapter();
        const sampleCode = 'export function add(a: number, b: number): number { return a + b; }\n';
        const projector = tryCreateProjector(adapter, sampleCode, 'src/sample.ts', enabledNames, 0);
        expect(projector).not.toBeNull();

        const fallbackForLegacy = tryCreateProjector(
            adapter,
            sampleCode,
            'src/sample.ts',
            enabledNames,
            1,
        );
        expect(fallbackForLegacy).toBeNull();
    });
});
