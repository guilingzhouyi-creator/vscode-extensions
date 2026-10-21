/**
 * Module: Fractal Git — VFS Adapter Facade
 * File Path: ts/vfs/index.ts
 */

export * from "./vfs-adapter";

/**
 * Immutable facade metadata descriptor for the Fractal Git VFS driver.
 */
export const FRACTAL_VFS_FACADE_INFO = Object.freeze({
    subsystem: "fractal-git",
    tier: "vfs",
    driverVersion: "1.0.0",
});
