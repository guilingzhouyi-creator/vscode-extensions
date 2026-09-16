/**
 * Module: Core Governance — Language Capability Profiles
 * File Path: src/core/governance/languageProfiles.ts
 * Architecture Role: Static capability catalog and O(1) extension-to-profile resolver that
 *     adapts a raw file path into the LanguageCapabilities contract used by rule evaluators.
 * Dependencies & Triggers: Imports LanguageCapabilities from ./types; consumed by
 *     GovernanceAnalyzer.ensureInitialized() per file before rule selection, receiving
 *     ctx.filePath and the optional adapter id.
 * Responsibilities: Define profiles for typescript, javascript, gdscript, rust, python,
 *     shell, and powershell (typing, inheritance, pattern matching, result/exception flags,
 *     debug identifiers, naming conventions); map 14 file extensions to profiles; extract
 *     extensions with a backward char scan; resolve extension first, then adapter id, then
 *     fall back to the typescript profile.
 * Exit Semantics & Design Rationale: Total function that never throws and always returns a
 *     profile; pure synchronous lookup keeps per-file initialization allocation-light, and
 *     the typescript fallback guarantees every scanned file remains analyzable.
 */
import type { LanguageCapabilities } from './types';

/**
 * Character code of `/`, the POSIX path separator recognized by the extension scanner.
 */
const FORWARD_SLASH_CHAR_CODE = 47;

/**
 * Character code of `\`, the Windows path separator recognized by the extension scanner.
 */
const BACKSLASH_CHAR_CODE = 92;

/**
 * Character code of `.`, the extension separator recognized by the extension scanner.
 */
const DOT_CHAR_CODE = 46;

/** Naming-convention id for lower-case hyphenated names (`kebab-case`). */
const NAMING_KEBAB_CASE = 'kebab-case';

/** Naming-convention id for UpperCamelCase class/type names (`PascalCase`). */
const NAMING_PASCAL_CASE = 'PascalCase';

/** Naming-convention id for lowerCamelCase function/variable names (`camelCase`). */
const NAMING_CAMEL_CASE = 'camelCase';

/** Naming-convention id for SCREAMING_SNAKE_CASE constants (`UPPER_SNAKE_CASE`). */
const NAMING_UPPER_SNAKE_CASE = 'UPPER_SNAKE_CASE';

/** Naming-convention id for lower-case underscore names (`snake_case`). */
const NAMING_SNAKE_CASE = 'snake_case';

/**
 * Canonical registry of language capability descriptors keyed by profile id.
 *
 * Each entry declares typing, inheritance, pattern-matching, result/exception and
 * naming-convention facts consumed by governance rule selection; ids double as
 * adapter fallbacks for {@link resolveLanguageProfile}. Entries are shared
 * read-only descriptors, so mutating one would affect every consumer.
 */
export const LANGUAGE_PROFILES: Record<string, LanguageCapabilities> = {
    typescript: {
        languageId: 'typescript',
        supportsStaticTyping: true,
        supportsTypeInference: true,
        supportsClassInheritance: true,
        supportsPatternMatching: false,
        hasResultType: false,
        hasExceptions: true,
        debugIdentifiers: [
            'console.log',
            'console.debug',
            'console.info',
            'console.trace',
            'debugger',
        ],
        namingConventions: {
            file: NAMING_KEBAB_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_CAMEL_CASE,
            variable: NAMING_CAMEL_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    javascript: {
        languageId: 'javascript',
        supportsStaticTyping: false,
        supportsTypeInference: false,
        supportsClassInheritance: true,
        supportsPatternMatching: false,
        hasResultType: false,
        hasExceptions: true,
        debugIdentifiers: [
            'console.log',
            'console.debug',
            'console.info',
            'console.trace',
            'debugger',
        ],
        namingConventions: {
            file: NAMING_KEBAB_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_CAMEL_CASE,
            variable: NAMING_CAMEL_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    gdscript: {
        languageId: 'gdscript',
        supportsStaticTyping: true,
        supportsTypeInference: true,
        supportsClassInheritance: true,
        supportsPatternMatching: true,
        hasResultType: true,
        hasExceptions: false,
        debugIdentifiers: ['print', 'print_debug', 'print_stack', 'breakpoint'],
        namingConventions: {
            file: NAMING_SNAKE_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_SNAKE_CASE,
            variable: NAMING_SNAKE_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    rust: {
        languageId: 'rust',
        supportsStaticTyping: true,
        supportsTypeInference: true,
        supportsClassInheritance: false, // Rust uses traits/impl composition
        supportsPatternMatching: true,
        hasResultType: true,
        hasExceptions: false, // Rust uses Result<T, E> and panic
        debugIdentifiers: ['println!', 'eprintln!', 'dbg!'],
        namingConventions: {
            file: NAMING_SNAKE_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_SNAKE_CASE,
            variable: NAMING_SNAKE_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    python: {
        languageId: 'python',
        supportsStaticTyping: true,
        supportsTypeInference: true,
        supportsClassInheritance: true,
        supportsPatternMatching: true,
        hasResultType: false,
        hasExceptions: true,
        debugIdentifiers: ['print', 'breakpoint'],
        namingConventions: {
            file: NAMING_SNAKE_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_SNAKE_CASE,
            variable: NAMING_SNAKE_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    shell: {
        languageId: 'shell',
        supportsStaticTyping: false,
        supportsTypeInference: false,
        supportsClassInheritance: false,
        supportsPatternMatching: true,
        hasResultType: false,
        hasExceptions: false,
        debugIdentifiers: ['echo', 'set -x'],
        namingConventions: {
            file: NAMING_KEBAB_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_SNAKE_CASE,
            variable: NAMING_SNAKE_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
    powershell: {
        languageId: 'powershell',
        supportsStaticTyping: true,
        supportsTypeInference: true,
        supportsClassInheritance: true,
        supportsPatternMatching: true,
        hasResultType: false,
        hasExceptions: true,
        debugIdentifiers: ['Write-Host', 'Write-Debug'],
        namingConventions: {
            file: NAMING_KEBAB_CASE,
            class: NAMING_PASCAL_CASE,
            function: NAMING_PASCAL_CASE,
            variable: NAMING_CAMEL_CASE,
            constant: NAMING_UPPER_SNAKE_CASE,
        },
    },
};

/**
 * Direct extension-to-profile Map for O(1) single-lookup resolution.
 */
const EXT_TO_PROFILE = new Map<string, LanguageCapabilities>([
    ['.ts', LANGUAGE_PROFILES.typescript],
    ['.tsx', LANGUAGE_PROFILES.typescript],
    ['.mts', LANGUAGE_PROFILES.typescript],
    ['.cts', LANGUAGE_PROFILES.typescript],
    ['.js', LANGUAGE_PROFILES.javascript],
    ['.jsx', LANGUAGE_PROFILES.javascript],
    ['.mjs', LANGUAGE_PROFILES.javascript],
    ['.cjs', LANGUAGE_PROFILES.javascript],
    ['.gd', LANGUAGE_PROFILES.gdscript],
    ['.rs', LANGUAGE_PROFILES.rust],
    ['.py', LANGUAGE_PROFILES.python],
    ['.sh', LANGUAGE_PROFILES.shell],
    ['.bash', LANGUAGE_PROFILES.shell],
    ['.ps1', LANGUAGE_PROFILES.powershell],
]);

/**
 * High-performance zero-allocation backward ASCII extension scanner.
 * Avoids path.extname() cross-platform path overhead.
 */
function fastExtname(filePath: string): string {
    const len = filePath.length;
    let dot = -1;
    for (let i = len - 1; i >= 0; i--) {
        const code = filePath.charCodeAt(i);
        if (code === FORWARD_SLASH_CHAR_CODE /* '/' */ || code === BACKSLASH_CHAR_CODE /* '\' */) {
            break;
        }
        if (code === DOT_CHAR_CODE /* '.' */) {
            dot = i;
            break;
        }
    }
    return dot === -1 ? '' : filePath.slice(dot).toLowerCase();
}

/**
 * Resolve the language capabilities profile for a given file.
 * Fast-path: O(1) direct map lookup on extracted extension.
 *
 * @param filePath - Path whose extension selects the profile; matching is case-insensitive.
 * @param adapterId - Optional adapter/language id consulted only when the extension is unknown.
 * @returns The matching profile, falling back to the typescript profile when nothing matches.
 */
export function resolveLanguageProfile(filePath: string, adapterId?: string): LanguageCapabilities {
    const ext = fastExtname(filePath);
    const profile = EXT_TO_PROFILE.get(ext);
    if (profile) return profile;

    if (adapterId && LANGUAGE_PROFILES[adapterId]) {
        return LANGUAGE_PROFILES[adapterId];
    }
    return LANGUAGE_PROFILES.typescript;
}
