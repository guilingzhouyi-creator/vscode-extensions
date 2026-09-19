/**
 * Module: Core Engine — Diagnostic Message & Prompt Template Type Contract
 * File Path: src/core/messages/types.ts
 * Architecture Role: Type-only root of the messages catalog; catalog modules import their
 *   descriptor contract from here and src/core/messages/index.ts re-exports it to consumers
 * Dependencies & Triggers: Imports nothing and emits no runtime code (one interface plus type
 *   aliases); imported at compile time by ./security, ./secrets and the other message catalogs
 * Responsibilities: Define the readonly DiagnosticDescriptor shape (required message; optional
 *   suggestion/rationale; risk limited to Low/Medium/High/Critical) and the generic
 *   MessageFormatter/DescriptorFormatter signatures used to type message factories
 * Exit Semantics & Design Rationale: Zero runtime footprint means importing it cannot throw or
 *   create cycles; keeping the contract narrow forces every catalog entry to supply a message and
 *   constrains severity literals through the type system rather than runtime validation
 */

/**
 * Read-only shape of one diagnostic catalog entry: a mandatory `message` plus optional
 * remediation context and a bounded risk tier.
 *
 * Core messages adhere strictly to the English baseline contract for uniform downstream
 * consumption (SARIF reporting, CI parsers, and LLM Agent prompt injection). User-facing
 * Chinese localized guidelines are decoupled at the rule registry layer.
 *
 * The optional fields let every catalog share one render path, so consumers must tolerate
 * their absence. `risk` is deliberately narrowed to four literals, which validates severity
 * through the compiler instead of ad-hoc runtime checks.
 */
export interface DiagnosticDescriptor {
    readonly message: string;
    readonly suggestion?: string;
    readonly rationale?: string;
    readonly risk?: 'Low' | 'Medium' | 'High' | 'Critical';
}

/**
 * Renders one catalog entry's message from a typed placeholder bag.
 *
 * Implementations are synchronous and pure: for equal `params` the returned text must be
 * identical, so callers may cache or compare results without observing hidden state.
 *
 * @param params - Placeholder values keyed by the names embedded in the message template.
 * @returns The rendered, non-empty message text for the catalog entry.
 */
export type MessageFormatter<T extends Record<string, any>> = (params: T) => string;

/**
 * Renders one catalog entry's full descriptor from a typed placeholder bag.
 *
 * Implementations are synchronous and pure: for equal `params` the returned descriptor must be
 * equivalent, keeping failure messages stable across repeated renders and report formats.
 *
 * @param params - Placeholder values keyed by the names embedded in the descriptor template.
 * @returns The assembled descriptor; `message` is always populated, while `suggestion`,
 *   `rationale` and `risk` appear only when the template defines them.
 */
export type DescriptorFormatter<T extends Record<string, any>> = (
    params: T,
) => DiagnosticDescriptor;
