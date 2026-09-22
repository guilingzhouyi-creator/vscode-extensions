/**
 * Module: Static Analysis — Data Access & Architecture Modernization
 * File Path: src/analyzers/data-architecture.ts
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
const FN_DECL_RE = /\b(?:function|class|async\s+function|def|func)\s+([A-Za-z0-9_$]+)/;
const METHOD_DECL_RE = /\b(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/;
const CONTROL_KEYWORD_RE = /^(?:if|for|while|switch|catch)$/;

function extractSymbolFromLine(trimmed: string): string | null {
    const fnMatch = trimmed.match(FN_DECL_RE);
    if (fnMatch) return fnMatch[1];
    const methodMatch = trimmed.match(METHOD_DECL_RE);
    if (methodMatch && !CONTROL_KEYWORD_RE.test(methodMatch[1])) {
        return methodMatch[1];
    }
    return null;
}

function updateLoopTracker(
    trimmed: string,
    currentIndent: number,
    tracker: { inLoop: boolean; loopIndent: number },
): void {
    if (LOOP_HEADER_RE.test(trimmed)) {
        tracker.inLoop = true;
        tracker.loopIndent = currentIndent >= 0 ? currentIndent : 0;
    } else if (tracker.inLoop && trimmed === '}' && currentIndent <= tracker.loopIndent) {
        tracker.inLoop = false;
    }
}

interface SiteMeta {
    filePath: string;
    lineNum: number;
    symbol: string;
    isOnline: boolean;
    isLoopContext: boolean;
}

type OperationKind = 'query' | 'serialization' | 'validation' | 'driver-call';

function pushSite(
    sites: DataAccessSite[],
    meta: SiteMeta,
    expressionText: string,
    operationKind: OperationKind,
    isUnboundedQuery = false,
): void {
    sites.push({
        file: meta.filePath,
        line: meta.lineNum,
        symbol: meta.symbol,
        isOnlinePath: meta.isOnline,
        isLoopContext: meta.isLoopContext,
        isUnboundedQuery,
        operationKind,
        expressionText,
    });
}

function checkAndPushSite(trimmed: string, meta: SiteMeta, sites: DataAccessSite[]): void {
    if (DRIVER_CALL_RE.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'driver-call');
    }
    if (QUERY_CALL_RE.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'query', UNBOUNDED_QUERY_RE.test(trimmed));
    }
    if (SERIALIZATION_RE.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'serialization');
    }
    if (VALIDATION_RE.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'validation');
    }
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

        const loopTracker = { inLoop: false, loopIndent: 0 };
        let currentSymbol = 'anonymous';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
                continue;
            }

            const symbol = extractSymbolFromLine(trimmed);
            if (symbol) {
                currentSymbol = symbol;
            }

            const currentIndent = line.search(/\S/);
            updateLoopTracker(trimmed, currentIndent, loopTracker);

            const inIter = loopTracker.inLoop || ITERATION_METHOD_RE.test(trimmed);
            checkAndPushSite(
                trimmed,
                {
                    filePath: ctx.filePath,
                    lineNum: i + 1,
                    symbol: currentSymbol,
                    isOnline,
                    isLoopContext: inIter,
                },
                sites,
            );
        }

        return analyzeDataAccessSites(sites, options);
    }
}
