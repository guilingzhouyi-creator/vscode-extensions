/**
 * Module: Core Engine — Praxis Client SDK Subsystem Facade
 * File Path: src/core/praxis/client/index.ts
 * Architecture Role: Primary barrel and entry point for the Praxis Client SDK subsystem,
 *   publishing types, directive serializers, and dual-faced diff generators.
 * Dependencies & Triggers: Re-exports ./types and ./agent-directives; consumed by
 *   praxisReviewClient.ts, praxis/index.ts, and external Praxis clients.
 * Responsibilities: Deliver clean, unified client contracts and immutable default configurations.
 * Exit Semantics & Design Rationale: Dependency-free barrel with immutable contract freezes,
 *   fulfilling facade discipline (ARCH-FAC-001) with zero runtime latency.
 */

export * from './types';
export * from './agent-directives';

import type { PraxisClientConfig } from './types';

/**
 * Immutable baseline configuration defaults for Praxis Client SDK.
 */
export const DEFAULT_PRAXIS_CLIENT_CONFIG: Readonly<PraxisClientConfig> = Object.freeze({
    enableMoE: true,
    includeDualFacedPresentation: true,
    defaultLocale: 'zh-CN',
});

/**
 * Validates and merges user configuration with standard client defaults.
 *
 * @param options - Caller supplied partial configuration
 * @returns Fully populated, immutable client configuration
 */
export function resolvePraxisClientConfig(options?: PraxisClientConfig): PraxisClientConfig {
    if (!options) {
        return { ...DEFAULT_PRAXIS_CLIENT_CONFIG };
    }
    return Object.freeze({
        root: options.root ?? process.cwd(),
        graph: options.graph,
        defaultCardContext: options.defaultCardContext,
        diffService: options.diffService,
        sliceService: options.sliceService,
        sparseRouter: options.sparseRouter,
        enableMoE: options.enableMoE ?? DEFAULT_PRAXIS_CLIENT_CONFIG.enableMoE,
        includeDualFacedPresentation:
            options.includeDualFacedPresentation ??
            DEFAULT_PRAXIS_CLIENT_CONFIG.includeDualFacedPresentation,
        defaultLocale: options.defaultLocale ?? DEFAULT_PRAXIS_CLIENT_CONFIG.defaultLocale,
    });
}
