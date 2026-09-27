/**
 * Module: Core Constants — System, File and Environment Protocol Tokens
 * File Path: src/core/constants/system-tokens.ts
 * Architecture Role: Single source of truth for file extensions, filesystem paths, character
 *     encodings, and environment protocols.
 * Dependencies & Triggers: Zero external dependencies; imported by I/O, cache, scanner,
 *     and CLI modules.
 * Responsibilities: Centralize canonical string tokens for extensions, standard encodings,
 *     common directory names, and process lifecycle tokens.
 * Exit Semantics & Design Rationale: Immutable constants preventing string typos across
 *     file discovery and cache management.
 */

// ============================================================================
// File Extensions
// ============================================================================

/** Standard file extension for ts files. */
export const EXT_TS = '.ts';
/** Standard file extension for js files. */
export const EXT_JS = '.js';
/** Standard file extension for json files. */
export const EXT_JSON = '.json';
/** Standard file extension for rs files. */
export const EXT_RS = '.rs';
/** Standard file extension for gd files. */
export const EXT_GD = '.gd';
/** Standard file extension for py files. */
export const EXT_PY = '.py';
/** Standard file extension for sh files. */
export const EXT_SH = '.sh';
/** Standard file extension for ps1 files. */
export const EXT_PS1 = '.ps1';

// ============================================================================
// Encodings and Charsets
// ============================================================================

/** Standard character encoding identifier for utf8. */
export const ENCODING_UTF8 = 'utf8';
/** Standard character encoding identifier for utf_8. */
export const ENCODING_UTF_8 = 'utf-8';

// ============================================================================
// Common System Directories and Paths
// ============================================================================

/** Standard workspace directory name for node_modules. */
export const DIR_NODE_MODULES = 'node_modules';
/** Standard workspace directory name for dist. */
export const DIR_DIST = 'dist';
/** Standard workspace directory name for src. */
export const DIR_SRC = 'src';
/** Standard workspace directory name for scripts. */
export const DIR_SCRIPTS = 'scripts';
/** Standard workspace directory name for tests. */
export const DIR_TESTS = 'tests';
/** Standard workspace directory name for baselines. */
export const DIR_BASELINES = 'baselines';
/** Standard workspace directory name for reports. */
export const DIR_REPORTS = 'reports';

// ============================================================================
// Standard Lifecycle and Switch States
// ============================================================================

/** Execution lifecycle toggle state for off. */
export const STATE_OFF = 'off';
/** Execution lifecycle toggle state for on. */
export const STATE_ON = 'on';
/** Execution lifecycle toggle state for auto. */
export const STATE_AUTO = 'auto';
