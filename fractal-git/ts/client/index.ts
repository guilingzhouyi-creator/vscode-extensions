/**
 * Module: Fractal Git — Client SDK Facade
 * File Path: ts/client/index.ts
 */

export * from "./praxis-client";

/**
 * Immutable facade metadata descriptor for the Fractal Git Client SDK.
 */
export const FRACTAL_CLIENT_FACADE_INFO = Object.freeze({
    subsystem: "fractal-git",
    tier: "client",
    protocolVersion: "1.0.0",
});
