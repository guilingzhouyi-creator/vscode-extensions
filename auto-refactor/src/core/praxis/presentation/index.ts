/**
 * Module: Core Engine - Praxis Presentation Subsystem Facade
 * File Path: src/core/praxis/presentation/index.ts
 * Architecture Role: Barrel entry point exposing presentation contracts, diagnostic card models,
 *   i18n translation dictionaries, presentation adapters, and semantic correlation deduplication.
 * Dependencies & Triggers: Re-exports ./i18n-types, ./i18n-provider, ./presentation-types,
 *   ./presentation-adapter, and ./semantic-correlation; consumed by praxis/index and public API.
 * Responsibilities: Deliver a clean, unified export surface for Praxis frontend consumers.
 * Exit Semantics & Design Rationale: Dependency-free barrel with Object.freeze immutability;
 *   preserves internal module freedom and contract integrity.
 */

export * from './i18n-types';
export * from './i18n-provider';
export * from './presentation-types';
export * from './presentation-adapter';
export * from './semantic-correlation';

import {
    SEMANTIC_OVERLAP_GROUPS,
    aggregateSemanticOverlappingCards,
} from './semantic-correlation';
import {
    defaultPraxisPresentationService,
    createPraxisPresentationService,
} from './presentation-adapter';
import {
    defaultPraxisI18nProvider,
    createPraxisI18nProvider,
} from './i18n-provider';

/**
 * Frozen presentation module facade contract guaranteeing immutability.
 */
export const PRAXIS_PRESENTATION_FACADE = Object.freeze({
    SEMANTIC_OVERLAP_GROUPS,
    aggregateSemanticOverlappingCards,
    defaultPraxisPresentationService,
    createPraxisPresentationService,
    defaultPraxisI18nProvider,
    createPraxisI18nProvider,
});
