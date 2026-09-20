/**
 * Module: Core Engine — Analyzer Module Loading Adapter
 * File Path: src/core/load-analyzer.ts
 * Architecture Role: Adapter that normalizes an arbitrary CommonJS/ESM export shape into an
 *                    Analyzer instance; used for external plug-ins in the main process and for
 *                    built-in/custom analyzers reconstructed inside worker threads.
 * Dependencies & Triggers: Imports the Analyzer contract from ./types; triggered by analyzer.ts,
 *                    analyzerRegistry.ts and worker.ts right after a module is required/imported.
 * Responsibilities: Accept a class/function export, an already-instantiated analyzer exposing
 *                    analyze(), or an object export resolved as default, Analyzer, the requested
 *                    name or the first function; construct the instance and reject results whose
 *                    analyze is not callable.
 * Exit Semantics & Design Rationale: Fails fast with a clear Error naming the offending analyzer
 *                    when no valid Analyzer can be derived; the caller converts that into an
 *                    AutoRefactorError config-level failure (non-zero CLI exit) so a broken plug-in
 *                    is never silently skipped.
 */

import type { Analyzer } from './types';

/** `typeof` tag identifying callable module exports and analyzer methods. */
const TYPEOF_FUNCTION = 'function';

/**
 * Resolve a loaded module into an `Analyzer` instance.
 *
 * Handles every export shape we support (used both for external plug-ins in the
 * main process and for built-in/custom analyzers reconstructed inside workers):
 *   module.exports = Class                       -> typeof mod === 'function'
 *   module.exports = new Analyzer()             -> mod.analyze is a function (already instance)
 *   module.exports = { default: Class, ... } -> pick default / Analyzer / `name` / first function
 *
 * Throws a clear error if no valid analyzer can be derived (caller turns it into
 * an AutoRefactorError for config-level failures).
 *
 * @param mod - Loaded module value to normalize: a constructor function, an analyzer instance,
 *   or an object export whose default / `Analyzer` / `name` key / first function is used.
 * @param name - Declared analyzer name, used both to look up a named object export and to name
 *   the analyzer in the error message when no valid shape is found.
 * @returns A ready-to-use Analyzer; an already-instantiated module value is reused as-is, while
 *   class-like exports are constructed fresh so callers never share one instance accidentally.
 * @throws When no export shape resolves to an object whose `analyze` member is callable.
 */
export function instantiateAnalyzer(mod: any, name: string): Analyzer {
    let resolved: Analyzer | null = null;
    if (typeof mod === TYPEOF_FUNCTION) {
        resolved = new mod();
    } else if (mod && typeof mod === 'object') {
        if (typeof mod.analyze === TYPEOF_FUNCTION) {
            resolved = mod as Analyzer;
        } else {
            const Ctor =
                mod.default ||
                mod.Analyzer ||
                mod[name] ||
                Object.values(mod).find((v: any) => typeof v === TYPEOF_FUNCTION);
            if (typeof Ctor === TYPEOF_FUNCTION) resolved = new Ctor();
        }
    }
    if (!resolved || typeof resolved.analyze !== TYPEOF_FUNCTION) {
        throw new Error(`custom analyzer "${name}" does not export a valid Analyzer`);
    }
    return resolved;
}
