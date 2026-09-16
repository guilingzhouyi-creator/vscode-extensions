/**
 * Module: Core Engine — Praxis Ecosystem Extension Layer
 * File Path: src/core/praxis/index.ts
 * Architecture Role: Facade entry point that exposes the Praxis contract surface and its
 *   built-in defaults as one import path, decoupling consumers from internal file layout.
 * Dependencies & Triggers: Re-exports `./contracts` then `./defaults`; triggers when module
 *   resolution reaches `.../praxis` or `.../praxis/index`, loading those two children once
 *   under Node/TypeScript module caching.
 * Responsibilities: Publish every contract interface and type plus every default
 *   resolver/enricher/policy/storage/gatekeeper class and `createDefaultPraxisHooks`;
 *   contain no runtime logic of its own beyond the two `export *` statements.
 * Exit Semantics & Design Rationale: Evaluation succeeds once both child modules load and
 *   throws only if one of them fails; a tiny dependency-free barrel gives plugin authors
 *   one stable entry path while the files behind it remain free to move.
 */

export * from './contracts';
export * from './defaults';
