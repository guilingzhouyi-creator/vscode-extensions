/**
 * Module: Core Messages - Diagnostic Catalog Aggregation Barrel
 * File Path: src/core/messages/index.ts
 * Architecture Role: Public barrel for all message and type submodules; gives analyzers,
 *   scorers, and API consumers one stable import path for the message contract.
 * Dependencies & Triggers: Re-exports ./types, ./security, ./architecture, ./governance,
 *   ./performance, ./comments, ./hygiene, ./secrets, ./scoring, ./trajectory, and ./guidance.
 *   Evaluated whenever a consumer imports ../core/messages, including CLI/CI/daemon bootstrap.
 * Responsibilities: Publish the eleven listed submodules under one namespace, exposing strongly
 *   typed descriptors, standardized English messages, remediation suggestions, scoring
 *   rationales, trajectory notifications, and agent guidance templates, with no filtering,
 *   transformation, or runtime side effects of its own.
 * Exit Semantics & Design Rationale: Static export-only module; successful load means every
 *   submodule resolved, while a missing or renamed submodule fails fast at build or import time
 *   rather than silently hiding diagnostics. Barrel re-exports preserve downstream import
 *   stability and the public src/api.ts message surface; no fallback path exists by design.
 */

export * from './types';
export * from './security';
export * from './architecture';
export * from './governance';
export * from './performance';
export * from './comments';
export * from './hygiene';
export * from './secrets';
export * from './scoring';
export * from './trajectory';
export * from './guidance';
