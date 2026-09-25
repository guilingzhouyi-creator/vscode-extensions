/**
 * Module: Core Engine - Comment Governance Subsystem Facade
 * File Path: src/core/comments/index.ts
 * Architecture Role: Barrel entry point exposing comment governance contracts, profilers,
 *   effective comment density models, and semantic duty matchers.
 * Dependencies & Triggers: Re-exports ./comment-types, ./project-comment-profiler,
 *   ./comment-density-model, and ./comment-semantic-matcher.
 * Responsibilities: Deliver a clean, unified import surface for comment governance.
 * Exit Semantics & Design Rationale: Dependency-free barrel; preserves internal module freedom.
 */

export * from './comment-types';
export * from './project-comment-profiler';
export * from './comment-density-model';
export * from './comment-semantic-matcher';
export * from './comment-auditor';
