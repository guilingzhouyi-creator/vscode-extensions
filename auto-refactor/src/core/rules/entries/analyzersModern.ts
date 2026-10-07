/**
 * Module: Core Rules — Modern Rule Entries Facade
 * File Path: src/core/rules/entries/analyzersModern.ts
 * Architecture Role: Facade aggregating language, GDScript, and architecture rules.
 * Dependencies & Triggers: ./analyzers-modern-languages, ./analyzers-modern-gdscript,
 *   ./analyzers-modern-architecture.
 * Responsibilities: Re-export ANALYZER_MODERN_RULES to maintain backwards compatibility.
 * Exit Semantics & Design Rationale: Pure re-export facade keeping all files < 900 LOC.
 */

import type { RuleDefinition } from '../types';
import { ANALYZER_MODERN_LANGUAGE_RULES } from './analyzers-modern-languages';
import {
    ANALYZER_MODERN_GDSCRIPT_RULES,
    REMEDIATION_STANDARD_AND_ABOVE,
} from './analyzers-modern-gdscript';
import { ANALYZER_MODERN_ARCHITECTURE_RULES } from './analyzers-modern-architecture';
import { ANALYZER_MODERN_FRONTEND_RULES } from './analyzers-modern-frontend';

export { REMEDIATION_STANDARD_AND_ABOVE };
export { ANALYZER_MODERN_LANGUAGE_RULES } from './analyzers-modern-languages';
export { ANALYZER_MODERN_GDSCRIPT_RULES } from './analyzers-modern-gdscript';
export { ANALYZER_MODERN_ARCHITECTURE_RULES } from './analyzers-modern-architecture';
export { ANALYZER_MODERN_FRONTEND_RULES } from './analyzers-modern-frontend';

/**
 * Modern analyzer rule definitions cataloging TypeScript,
 * Python, architecture, performance, GDScript, and polyglot rules.
 */
export const ANALYZER_MODERN_RULES: readonly RuleDefinition[] = [
    ...ANALYZER_MODERN_LANGUAGE_RULES,
    ...ANALYZER_MODERN_GDSCRIPT_RULES,
    ...ANALYZER_MODERN_ARCHITECTURE_RULES,
    ...ANALYZER_MODERN_FRONTEND_RULES,
];
