/**
 * Module: Static Analysis — Data Access & Architecture Modernization
 * File Path: src/analyzers/dataArchitecture.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects data layer
 *   boundaries, query shapes, N+1 patterns, and serialization hotspots.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), dataArchitecture
 *   intelligence module; triggered when 'data-architecture' analyzer is enabled.
 * Responsibilities: Detect unbounded queries on online request paths (DAT-QRY-001); detect
 *   N+1 queries within loops (DAT-NPL-001); detect redundant serialization in hot paths
 *   (DAT-SER-001); flag driver leaks in interface layers (DAT-LAY-001); flag excessive defensive
 *   checks past trusted perimeters (DAT-DEF-001).
 * Exit Semantics & Design Rationale: Stateless and synchronous per file; returns Issue[] and
 *   never throws.
 */

import type * as ts from 'typescript';
import type { Analyzer, AnalyzerContext, Issue } from '../core/types';
import type {
    DataAccessSite,
    DataArchitectureOptions,
} from '../core/intelligence/dataArchitecture';
import {
    analyzeDataAccessSites,
    isOfflineOrMigrationContext,
} from '../core/intelligence/dataArchitecture';

/** Pattern detecting query or fetch calls against database/storage. */
const QUERY_CALL_RE = /\b(?:find|findAll|select|query|fetchRecords|getBy|queryAll)\s*\(/;

/** Pattern detecting unpaginated/unbounded query keywords. */
const UNBOUNDED_QUERY_RE =
    /(?:\b(?:findAll|selectAll|getAll|find\(\s*\)|select\(\s*\))\b|\bSELECT\s+\*)/i;

/** Pattern detecting JSON serialization/deserialization calls. */
const SERIALIZATION_RE = /\bJSON\.(?:parse|stringify)\s*\(/;

/** Pattern detecting invariant or parameter validation checks. */
const VALIDATION_RE = /\b(?:assert|validate|checkNotNull|ensureValid|requireNonEmpty)\s*\(/;

/** Pattern detecting raw database driver calls. */
const DRIVER_CALL_RE = /\b(?:db\.query|pool\.execute|client\.query|execSql|rawQuery)\s*\(/;

/** Pattern detecting loop headers or array iteration methods. */
const LOOP_HEADER_RE = /\b(?:for\s*\(|for\s+[a-zA-Z0-9_$]+\s+in|while\s*\(|do\s*\{)\b/;
const ITERATION_METHOD_RE = /\.(?:map|forEach|filter|flatMap)\s*\(/;

/**
 * Determine whether the analyzed file belongs to an online request/response path.
 */
/** Default keyword indicators for online request/response paths. */
const DEFAULT_ONLINE_KEYWORDS = [
    'api',
    'controller',
    'route',
    'handler',
    'service',
    'endpoint',
    'resolver',
    'rpc',
];

/** Default keyword indicators for offline, batch, test, or migration paths. */
const DEFAULT_OFFLINE_KEYWORDS = [
    '/test/',
    '/tests/',
    '/spec/',
    '/fixtures/',
    '/scripts/',
    '/benchmarks/',
    'migration',
    'seed',
];

/**
 * Determine whether the analyzed file belongs to an online request/response path.
 */
function isOnlineExecutionContext(
    filePath: string,
    content: string,
    options?: DataArchitectureOptions,
): boolean {
    if (isOfflineOrMigrationContext(filePath, content)) {
        return false;
    }
    const lower = filePath.toLowerCase().replace(/\\/g, '/');
    const offlinePatterns = options?.offlinePathPatterns ?? DEFAULT_OFFLINE_KEYWORDS;
    if (offlinePatterns.some((pattern) => lower.includes(pattern.toLowerCase()))) {
        return false;
    }

    const onlinePatterns = options?.onlinePathPatterns ?? DEFAULT_ONLINE_KEYWORDS;
    const matchesPattern = onlinePatterns.some((pattern) => lower.includes(pattern.toLowerCase()));

    return (
        matchesPattern ||
        /@(?:Get|Post|Put|Delete|Patch|Route|Query|Mutation)\b/.test(content) ||
        /\b(?:express|fastify|koa|router)\s*\(\s*\)/.test(content)
    );
}

/**
 * Analyzer detecting database access antipatterns and data architecture violations.
 */
export class DataArchitectureAnalyzer implements Analyzer {
    name = 'data-architecture' as const;

    analyze(sf: ts.SourceFile, ctx: AnalyzerContext): Issue[] {
        void sf;
        const options = (ctx.config.analyzers['data-architecture']?.options ||
            {}) as DataArchitectureOptions;
        const content = ctx.content;
        const lines = content.split('\n');
        const sites: DataAccessSite[] = [];
        const isOnline = isOnlineExecutionContext(ctx.filePath, content, options);

        let inLoop = false;
        let loopIndent = 0;
        let currentSymbol = 'anonymous';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const lineNum = i + 1;
            const currentIndent = line.search(/\S/);

            if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }

            // Track function/method symbol
            const fnMatch = trimmed.match(
                /\b(?:function|class|async\s+function|def|func)\s+([A-Za-z0-9_$]+)/,
            );
            if (fnMatch) {
                currentSymbol = fnMatch[1];
            } else {
                const methodMatch = trimmed.match(
                    /\b(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
                );
                if (
                    methodMatch &&
                    methodMatch[1] !== 'if' &&
                    methodMatch[1] !== 'for' &&
                    methodMatch[1] !== 'while'
                ) {
                    currentSymbol = methodMatch[1];
                }
            }

            // Track loop context
            if (LOOP_HEADER_RE.test(trimmed)) {
                inLoop = true;
                loopIndent = currentIndent >= 0 ? currentIndent : 0;
            } else if (inLoop && trimmed === '}' && currentIndent <= loopIndent) {
                inLoop = false;
            }

            const inIter = inLoop || ITERATION_METHOD_RE.test(trimmed);

            // Raw driver check
            if (DRIVER_CALL_RE.test(trimmed)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inIter,
                    isUnboundedQuery: false,
                    operationKind: 'driver-call',
                    expressionText: trimmed,
                });
            }

            // Database query check
            if (QUERY_CALL_RE.test(trimmed)) {
                const isUnbounded = UNBOUNDED_QUERY_RE.test(trimmed);
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inIter,
                    isUnboundedQuery: isUnbounded,
                    operationKind: 'query',
                    expressionText: trimmed,
                });
            }

            // Serialization check
            if (SERIALIZATION_RE.test(trimmed)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inIter,
                    isUnboundedQuery: false,
                    operationKind: 'serialization',
                    expressionText: trimmed,
                });
            }

            // Validation check
            if (VALIDATION_RE.test(trimmed)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inIter,
                    isUnboundedQuery: false,
                    operationKind: 'validation',
                    expressionText: trimmed,
                });
            }
        }

        return analyzeDataAccessSites(sites, options);
    }
}
