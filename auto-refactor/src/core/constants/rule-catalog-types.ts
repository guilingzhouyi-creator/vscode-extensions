/**
 * Module: Core Constants — Auto-Refactor SSOT Rule Catalog Common Types
 * File Path: src/core/constants/rule-catalog-types.ts
 * Architecture Role: Foundational types for rule catalog metadata.
 * Dependencies & Triggers: Consumed by subdomain rule modules and rule catalog facade.
 * Responsibilities: Declare RuleCatalogMeta contract.
 * Exit Semantics & Design Rationale: Pure type definitions with zero runtime overhead.
 */

/** Metadata entry for a registered rule in auto-refactor. */
export interface RuleCatalogMeta {
    readonly id: string;
    readonly family: string;
    readonly severity: string;
    readonly summary: string;
    readonly canonical: boolean;
}
