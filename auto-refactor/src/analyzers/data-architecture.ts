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
import { isToolOrTestScript } from '../core/governance/pathScope';
import type {
    DataAccessSite,
    DataArchitectureOptions,
} from '../core/intelligence/dataArchitecture';
import {
    analyzeDataAccessSites,
    isOfflineOrMigrationContext,
} from '../core/intelligence/dataArchitecture';
import { REGEX, isDataQueryCall } from '../core/constants';

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
        REGEX.DATA.ONLINE_ROUTE_DECORATOR.test(content) ||
        REGEX.DATA.SERVER_FRAMEWORK_INIT.test(content)
    );
}

function extractSymbolFromLine(trimmed: string): string | null {
    const fnMatch = trimmed.match(REGEX.DATA.FN_DECL);
    if (fnMatch) return fnMatch[1];
    const methodMatch = trimmed.match(REGEX.DATA.METHOD_DECL);
    if (methodMatch && !REGEX.DATA.CONTROL_KEYWORD.test(methodMatch[1])) {
        return methodMatch[1];
    }
    return null;
}

function updateLoopTracker(
    trimmed: string,
    currentIndent: number,
    tracker: { inLoop: boolean; loopIndent: number },
): void {
    if (REGEX.DATA.LOOP_HEADER.test(trimmed)) {
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

type OperationKind = 'query' | 'serialization' | 'validation' | 'driver-call' | 'resource-registry';

/**
 * Report whether the line is regular-expression source instead of executable code.
 *
 * @param trimmed - Line text with surrounding whitespace removed.
 * @returns True when the line cannot contain a real call site.
 */
function isRegexLiteralLine(trimmed: string): boolean {
    return REGEX.DATA.REGEX_LITERAL_LINE.test(trimmed);
}

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
    if (REGEX.DATA.DRIVER_CALL.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'driver-call');
    }
    if (isDataQueryCall(trimmed) && !REGEX.DATA.MEMORY_STORE_RECEIVER.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'query', REGEX.DATA.UNBOUNDED_QUERY.test(trimmed));
    }
    if (REGEX.DATA.SERIALIZATION.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'serialization');
    }
    if (REGEX.DATA.VALIDATION.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'validation');
    }
    if (REGEX.DATA.DANGLING_RESOURCE_PATH.test(trimmed)) {
        pushSite(sites, meta, trimmed, 'resource-registry');
    }
}

/**
 * Analyzer detecting database access antipatterns and data architecture violations.
 */
export class DataArchitectureAnalyzer implements Analyzer {
    name = 'data-architecture' as const;

    analyze(sourceFile: ts.SourceFile | undefined, ctx: AnalyzerContext): Issue[] {
        void sourceFile;
        if (isToolOrTestScript(ctx.filePath)) {
            return [];
        }
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
            const inLoopBefore = loopTracker.inLoop;
            updateLoopTracker(trimmed, currentIndent, loopTracker);

            // Expressions on the loop header itself (e.g. for (const x of coll)) execute once
            // outside iteration
            const inIter =
                inLoopBefore ||
                (loopTracker.inLoop && !REGEX.DATA.LOOP_HEADER.test(trimmed)) ||
                REGEX.DATA.ITERATION_METHOD.test(trimmed);
            if (!isRegexLiteralLine(trimmed)) {
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
        }

        return analyzeDataAccessSites(sites, options);
    }

    /**
     * Shared streaming traversal finalizer; delegates to standard analyze without
     * requiring an explicit SourceFile AST instance.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(ctx.sourceFile, ctx);
    }
}
