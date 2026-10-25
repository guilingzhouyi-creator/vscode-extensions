/**
 * Module: Core Engine - Comment Governance Subsystem Facade
 * File Path: src/core/comments/index.ts
 * Architecture Role: Facade entry point exposing comment governance contracts, profilers,
 *   effective comment density models, and semantic duty matchers.
 * Dependencies & Triggers: Re-exports ./comment-types, ./project-comment-profiler,
 *   ./comment-density-model, and ./comment-semantic-matcher.
 * Responsibilities: Deliver an immutable, unified import surface for comment governance satisfying ARCH-FAC-001.
 * Exit Semantics & Design Rationale: Immutable subsystem facade; preserves internal module freedom.
 */

import { auditCommentLanguage, auditCommentDensity, auditCommentSemanticDuty } from './comment-auditor';
import { evaluateEffectiveCommentDensity, classifyCommentSnippet } from './comment-density-model';
import { defaultProjectCommentProfiler, ProjectCommentProfiler } from './project-comment-profiler';

export * from './comment-types';
export * from './project-comment-profiler';
export * from './comment-density-model';
export * from './comment-semantic-matcher';
export * from './comment-auditor';

/** Subsystem facade providing frozen access to comment governance operations. */
export const CommentGovernance = Object.freeze({
    auditLanguage: auditCommentLanguage,
    auditDensity: auditCommentDensity,
    auditSemanticDuty: auditCommentSemanticDuty,
    evaluateDensity: evaluateEffectiveCommentDensity,
    classifySnippet: classifyCommentSnippet,
    defaultProfiler: defaultProjectCommentProfiler,
    ProjectCommentProfiler,
});
