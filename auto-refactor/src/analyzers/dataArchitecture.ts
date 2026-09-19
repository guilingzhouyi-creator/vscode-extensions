/**
 * Module: Static Analysis — Data Access & Architecture Modernization
 * File Path: src/analyzers/dataArchitecture.ts
 * Architecture Role: Analyzer adapter implementing the Analyzer contract; inspects data
 *   access, query patterns, serialization, and defensive boundaries.
 * Dependencies & Triggers: Core types (Analyzer, AnalyzerContext, Issue), dataArchitecture
 *   intelligence module; triggered when 'data-architecture' analyzer is enabled.
 * Responsibilities: Detect unbounded queries on online paths (DAT-QRY-001); detect N+1
 *   loop queries (DAT-NPL-001); detect redundant serialization (DAT-SER-001); detect
 *   excessive defensive validation in internal domains (DAT-DEF-001); flag persistence
 *   driver leaks in business logic (DAT-LAY-001).
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
const UNBOUNDED_QUERY_RE = /\b(?:findAll|selectAll|getAll|find\(\s*\)|select\(\s*\))\b/;

/** Pattern detecting JSON serialization/deserialization calls. */
const SERIALIZATION_RE = /\bJSON\.(?:parse|stringify)\s*\(/;

/** Pattern detecting invariant or parameter validation checks. */
const VALIDATION_RE = /\b(?:assert|validate|checkNotNull|ensureValid|requireNonEmpty)\s*\(/;

/** Pattern detecting raw database driver calls. */
const DRIVER_CALL_RE = /\b(?:db\.query|pool\.execute|client\.query|execSql|rawQuery)\s*\(/;

/** Pattern detecting loop headers or array iteration methods. */
const LOOP_CONTEXT_RE = /\b(?:for\s*\(|while\s*\(|\.map\s*\(|\.forEach\s*\(|\.filter\s*\()/;

/**
 * Analyzer detecting anti-patterns in data access and architecture.
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
        const isOffline = isOfflineOrMigrationContext(ctx.filePath, '');
        const isOnline =
            !isOffline &&
            (ctx.filePath.includes('api') ||
                ctx.filePath.includes('controller') ||
                ctx.filePath.includes('route') ||
                ctx.filePath.includes('handler') ||
                ctx.filePath.includes('service'));

        let inLoop = false;
        let currentSymbol = 'anonymous';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNum = i + 1;

            // Track function/method symbol
            const fnMatch = line.match(
                /(?:function\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_$]+)\s*\([^)]*\)\s*[{:])/,
            );
            if (fnMatch) {
                currentSymbol = fnMatch[1] || fnMatch[2] || currentSymbol;
            }

            // Track loop context
            if (LOOP_CONTEXT_RE.test(line)) {
                inLoop = true;
            }
            if (line.includes('}') && inLoop) {
                // Approximate loop boundary exit
                inLoop = false;
            }

            // Detect raw driver call
            if (DRIVER_CALL_RE.test(line)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inLoop,
                    isUnboundedQuery: false,
                    operationKind: 'driver-call',
                    expressionText: line.trim(),
                });
            }

            // Detect query
            if (QUERY_CALL_RE.test(line)) {
                const isUnbounded = UNBOUNDED_QUERY_RE.test(line);
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inLoop,
                    isUnboundedQuery: isUnbounded,
                    operationKind: 'query',
                    expressionText: line.trim(),
                });
            }

            // Detect serialization
            if (SERIALIZATION_RE.test(line)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inLoop,
                    isUnboundedQuery: false,
                    operationKind: 'serialization',
                    expressionText: line.trim(),
                });
            }

            // Detect validation
            if (VALIDATION_RE.test(line)) {
                sites.push({
                    file: ctx.filePath,
                    line: lineNum,
                    symbol: currentSymbol,
                    isOnlinePath: isOnline,
                    isLoopContext: inLoop,
                    isUnboundedQuery: false,
                    operationKind: 'validation',
                    expressionText: line.trim(),
                });
            }
        }

        return analyzeDataAccessSites(sites, options);
    }
}
