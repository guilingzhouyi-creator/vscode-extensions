/**
 * Module: Core Engine — Control Flow Graph & Dataflow Exports
 * File Path: src/core/cfg/index.ts
 * Architecture Role: Single entry point exporting CFG node structures, graph builder,
 *                    dataflow def-use chain analyzer, and associated invariant types.
 * Dependencies & Triggers: Consumed by pattern matchers, analyzers, and verification harnesses.
 * Responsibilities: Re-export all CFG models and operators with frozen subsystem facade.
 * Exit Semantics & Design Rationale: Centralized API facade satisfying ARCH-FAC-001.
 */

import { BasicBlock } from './basic-block';
import { CfgBuilder, ControlFlowGraph } from './cfg-builder';
import { DefUseAnalyzer } from './def-use-chain';

export * from './types';
export * from './basic-block';
export * from './cfg-builder';
export * from './def-use-chain';

/** Subsystem facade providing frozen access to CFG construction and dataflow analysis operators. */
export const CfgEngine = Object.freeze({
    BasicBlock,
    CfgBuilder,
    ControlFlowGraph,
    DefUseAnalyzer,
});
