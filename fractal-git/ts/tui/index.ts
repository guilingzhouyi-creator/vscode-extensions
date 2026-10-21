/**
 * Module: Fractal Git — TUI Facade
 * File Path: ts/tui/index.ts
 */

export * from "./tree-renderer";

/**
 * Immutable facade metadata descriptor for the Fractal Git TUI visualizer.
 */
export const FRACTAL_TUI_FACADE_INFO = Object.freeze({
    subsystem: "fractal-git",
    tier: "tui",
    rendererVersion: "1.0.0",
});
