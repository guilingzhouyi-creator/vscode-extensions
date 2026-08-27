import { Analyzer } from './types';

/**
 * Resolve a loaded module into an `Analyzer` instance.
 *
 * Handles every export shape we support (used both for external plug-ins in the
 * main process and for built-in/custom analyzers reconstructed inside workers):
 *   module.exports = Class                       -> typeof mod === 'function'
 *   module.exports = new Analyzer()             -> mod.analyze is a function (already instance)
 *   module.exports = { default: Class, ... }     -> pick default / Analyzer / <name> / first function
 *
 * Throws a clear error if no valid analyzer can be derived (caller turns it into
 * an AutoRefactorError for config-level failures).
 */
export function instantiateAnalyzer(mod: any, name: string): Analyzer {
  let resolved: Analyzer | null = null;
  if (typeof mod === 'function') {
    resolved = new mod();
  } else if (mod && typeof mod === 'object') {
    if (typeof mod.analyze === 'function') {
      resolved = mod as Analyzer;
    } else {
      const Ctor =
        mod.default ||
        mod.Analyzer ||
        mod[name] ||
        Object.values(mod).find((v: any) => typeof v === 'function');
      if (typeof Ctor === 'function') resolved = new Ctor();
    }
  }
  if (!resolved || typeof resolved.analyze !== 'function') {
    throw new Error(`custom analyzer "${name}" does not export a valid Analyzer`);
  }
  return resolved;
}
