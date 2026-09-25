/**
 * Module: Core Engine - Native Acceleration Facade
 * File Path: src/core/native/index.ts
 * Architecture Role: Barrel entry point for native acceleration contracts and shims.
 * Dependencies & Triggers: Re-exports ./native-types and ./native-bridge.
 * Responsibilities: Expose unified native core API surface.
 * Exit Semantics & Design Rationale: Dependency-free barrel file.
 */

export * from './native-types';
export * from './native-bridge';
