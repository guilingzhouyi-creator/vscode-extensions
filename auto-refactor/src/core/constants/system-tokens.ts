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

export const EXT_TS = '.ts';
export const EXT_JS = '.js';
export const EXT_JSON = '.json';
export const EXT_RS = '.rs';
export const EXT_GD = '.gd';
export const EXT_PY = '.py';
export const EXT_SH = '.sh';
export const EXT_PS1 = '.ps1';

// ============================================================================
// Encodings and Charsets
// ============================================================================

export const ENCODING_UTF8 = 'utf8';
export const ENCODING_UTF_8 = 'utf-8';

// ============================================================================
// Common System Directories and Paths
// ============================================================================

export const DIR_NODE_MODULES = 'node_modules';
export const DIR_DIST = 'dist';
export const DIR_SRC = 'src';
export const DIR_SCRIPTS = 'scripts';
export const DIR_TESTS = 'tests';
export const DIR_BASELINES = 'baselines';
export const DIR_REPORTS = 'reports';

// ============================================================================
// Standard Lifecycle and Switch States
// ============================================================================

export const STATE_OFF = 'off';
export const STATE_ON = 'on';
export const STATE_AUTO = 'auto';
