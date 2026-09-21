/**
 * Module: Core Layer Compatibility Shim
 * File Path: src/core/python-adapter.ts
 * Architecture Role: Facade re-exporting ast/python-adapter
 *   to preserve full backward compatibility.
 * Dependencies & Triggers: Imported by external consumers expecting flat layout.
 * Responsibilities: Re-export all members from domain implementation module.
 * Exit Semantics & Design Rationale: Pure re-export module with zero runtime overhead.
 */
export * from './ast/python-adapter';
