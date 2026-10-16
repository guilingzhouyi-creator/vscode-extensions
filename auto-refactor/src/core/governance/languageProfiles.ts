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

const LANG_TYPESCRIPT = 'typescript';
const LANG_JAVASCRIPT = 'javascript';
const LANG_GDSCRIPT = 'gdscript';
const LANG_RUST = 'rust';
const LANG_PYTHON = 'python';
const LANG_GO = 'go';
const LANG_SHELL = 'shell';
const LANG_POWERSHELL = 'powershell';

const RAW_DEBUG_JS_TS = 'console.log\nconsole.debug\nconsole.info\nconsole.trace\ndebugger';
const RAW_DEBUG_GDSCRIPT = 'print\nprint_debug\nprint_stack\nbreakpoint';
const RAW_DEBUG_RUST = 'println!\neprintln!\ndbg!';
const RAW_DEBUG_PYTHON = 'print\nbreakpoint';
const RAW_DEBUG_GO = 'fmt.Println\nfmt.Printf\nlog.Println\nlog.Printf\npanic';
const RAW_DEBUG_SHELL = 'echo\nset -x';
const RAW_DEBUG_POWERSHELL = 'Write-Host\nWrite-Debug';

const DEBUG_JS_TS: readonly string[] = Object.freeze(RAW_DEBUG_JS_TS.split('\n'));
const DEBUG_GDSCRIPT: readonly string[] = Object.freeze(RAW_DEBUG_GDSCRIPT.split('\n'));
const DEBUG_RUST: readonly string[] = Object.freeze(RAW_DEBUG_RUST.split('\n'));
const DEBUG_PYTHON: readonly string[] = Object.freeze(RAW_DEBUG_PYTHON.split('\n'));
const DEBUG_GO: readonly string[] = Object.freeze(RAW_DEBUG_GO.split('\n'));
const DEBUG_SHELL: readonly string[] = Object.freeze(RAW_DEBUG_SHELL.split('\n'));
const DEBUG_POWERSHELL: readonly string[] = Object.freeze(RAW_DEBUG_POWERSHELL.split('\n'));

type NamingConventions = LanguageCapabilities['namingConventions'];

const NAMING_WEB: NamingConventions = {
    file: NAMING_KEBAB_CASE,
    class: NAMING_PASCAL_CASE,
    function: NAMING_CAMEL_CASE,
    variable: NAMING_CAMEL_CASE,
    constant: NAMING_UPPER_SNAKE_CASE,
};

const NAMING_SYSTEM: NamingConventions = {
    file: NAMING_SNAKE_CASE,
    class: NAMING_PASCAL_CASE,
    function: NAMING_SNAKE_CASE,
    variable: NAMING_SNAKE_CASE,
    constant: NAMING_UPPER_SNAKE_CASE,
};

const NAMING_GO: NamingConventions = {
    file: NAMING_SNAKE_CASE,
    class: NAMING_PASCAL_CASE,
    function: NAMING_CAMEL_CASE,
    variable: NAMING_CAMEL_CASE,
    constant: NAMING_UPPER_SNAKE_CASE,
};

const NAMING_SHELL: NamingConventions = {
    file: NAMING_KEBAB_CASE,
    class: NAMING_PASCAL_CASE,
    function: NAMING_SNAKE_CASE,
    variable: NAMING_SNAKE_CASE,
    constant: NAMING_UPPER_SNAKE_CASE,
};

const NAMING_POWERSHELL: NamingConventions = {
    file: NAMING_KEBAB_CASE,
    class: NAMING_PASCAL_CASE,
    function: NAMING_PASCAL_CASE,
    variable: NAMING_CAMEL_CASE,
    constant: NAMING_UPPER_SNAKE_CASE,
};

type FeatureTuple = readonly [
    typing: boolean,
    inference: boolean,
    inheritance: boolean,
    matching: boolean,
    resultType: boolean,
    exceptions: boolean,
];

const FEATURES_TS: FeatureTuple = [true, true, true, false, false, true];
const FEATURES_JS: FeatureTuple = [false, false, true, false, false, true];
const FEATURES_GD: FeatureTuple = [true, true, true, true, true, false];
const FEATURES_RS: FeatureTuple = [true, true, false, true, true, false];
const FEATURES_PY: FeatureTuple = [true, true, true, true, false, true];
const FEATURES_GO: FeatureTuple = [true, true, false, false, false, false];
const FEATURES_SH: FeatureTuple = [false, false, false, true, false, false];
const FEATURES_PS: FeatureTuple = [true, true, true, true, false, true];

function buildLanguageProfile(
    languageId: string,
    features: FeatureTuple,
    debugIdentifiers: readonly string[],
    namingConventions: NamingConventions,
): LanguageCapabilities {
    const [typing, inference, inheritance, matching, resultType, exceptions] = features;
    return {
        languageId,
        supportsStaticTyping: typing,
        supportsTypeInference: inference,
        supportsClassInheritance: inheritance,
        supportsPatternMatching: matching,
        hasResultType: resultType,
        hasExceptions: exceptions,
        debugIdentifiers: [...debugIdentifiers],
        namingConventions,
    };
}

/**
 * Canonical registry of language capability descriptors keyed by profile id.
 *
 * Each entry declares typing, inheritance, pattern-matching, result/exception and
 * naming-convention facts consumed by governance rule selection; ids double as
 * adapter fallbacks for {@link resolveLanguageProfile}. Entries are shared
 * read-only descriptors, so mutating one would affect every consumer.
 */
export const LANGUAGE_PROFILES: Record<string, LanguageCapabilities> = {
    [LANG_TYPESCRIPT]: buildLanguageProfile(LANG_TYPESCRIPT, FEATURES_TS, DEBUG_JS_TS, NAMING_WEB),
    [LANG_JAVASCRIPT]: buildLanguageProfile(LANG_JAVASCRIPT, FEATURES_JS, DEBUG_JS_TS, NAMING_WEB),
    [LANG_GDSCRIPT]: buildLanguageProfile(
        LANG_GDSCRIPT,
        FEATURES_GD,
        DEBUG_GDSCRIPT,
        NAMING_SYSTEM,
    ),
    [LANG_RUST]: buildLanguageProfile(LANG_RUST, FEATURES_RS, DEBUG_RUST, NAMING_SYSTEM),
    [LANG_PYTHON]: buildLanguageProfile(LANG_PYTHON, FEATURES_PY, DEBUG_PYTHON, NAMING_SYSTEM),
    [LANG_GO]: buildLanguageProfile(LANG_GO, FEATURES_GO, DEBUG_GO, NAMING_GO),
    [LANG_SHELL]: buildLanguageProfile(LANG_SHELL, FEATURES_SH, DEBUG_SHELL, NAMING_SHELL),
    [LANG_POWERSHELL]: buildLanguageProfile(
        LANG_POWERSHELL,
        FEATURES_PS,
        DEBUG_POWERSHELL,
        NAMING_POWERSHELL,
    ),
};

/**
 * Direct extension-to-profile Map for O(1) single-lookup resolution.
 */
const EXTENSION_PROFILES_MAP = new Map<string, LanguageCapabilities>([
    ['.ts', LANGUAGE_PROFILES[LANG_TYPESCRIPT]],
    ['.tsx', LANGUAGE_PROFILES[LANG_TYPESCRIPT]],
    ['.mts', LANGUAGE_PROFILES[LANG_TYPESCRIPT]],
    ['.cts', LANGUAGE_PROFILES[LANG_TYPESCRIPT]],
    ['.js', LANGUAGE_PROFILES[LANG_JAVASCRIPT]],
    ['.jsx', LANGUAGE_PROFILES[LANG_JAVASCRIPT]],
    ['.mjs', LANGUAGE_PROFILES[LANG_JAVASCRIPT]],
    ['.cjs', LANGUAGE_PROFILES[LANG_JAVASCRIPT]],
    ['.gd', LANGUAGE_PROFILES[LANG_GDSCRIPT]],
    ['.rs', LANGUAGE_PROFILES[LANG_RUST]],
    ['.py', LANGUAGE_PROFILES[LANG_PYTHON]],
    ['.go', LANGUAGE_PROFILES[LANG_GO]],
    ['.sh', LANGUAGE_PROFILES[LANG_SHELL]],
    ['.bash', LANGUAGE_PROFILES[LANG_SHELL]],
    ['.zsh', LANGUAGE_PROFILES[LANG_SHELL]],
    ['.ps1', LANGUAGE_PROFILES[LANG_POWERSHELL]],
    ['.psm1', LANGUAGE_PROFILES[LANG_POWERSHELL]],
    ['.psd1', LANGUAGE_PROFILES[LANG_POWERSHELL]],
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
    const profile = EXTENSION_PROFILES_MAP.get(ext);
    if (profile) return profile;

    if (adapterId && LANGUAGE_PROFILES[adapterId]) {
        return LANGUAGE_PROFILES[adapterId];
    }
    return LANGUAGE_PROFILES[LANG_TYPESCRIPT];
}
