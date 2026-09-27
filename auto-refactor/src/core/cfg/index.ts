/**
 * Module: Core Engine — Control Flow Graph & Dataflow Exports
 * File Path: src/core/cfg/index.ts
 * Architecture Role: Single entry point exporting CFG node structures, graph builder,
 *                    dataflow def-use chain analyzer, and associated invariant types.
 * Dependencies & Triggers: Consumed by pattern matchers, analyzers, and verification harnesses.
 * Responsibilities: Re-export all CFG models and operators.
 * Exit Semantics & Design Rationale: Centralized API barrel keeping import paths clean.
 */

export * from './types';
export * from './basic-block';
export * from './cfg-builder';
export * from './def-use-chain';
