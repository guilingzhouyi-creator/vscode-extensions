/**
 * Module: Static Analyzers — Custom Analyzer Boilerplate
 * File Path: .agents/skills/auto-refactor-dev/templates/analyzer-boilerplate.ts
 * Architecture Role: Custom static analysis AST visitor and finding emitter
 * Dependencies & Triggers: Invoked by analyzer-registry pipeline; depends on types and NormalizedNode
 * Responsibilities: Traverse AST to identify anti-patterns and emit structured findings
 * Exit Semantics & Design Rationale: Pure AST analysis, zero heap allocation in tight loops
 */
import { Analyzer, Finding, Severity } from '../types';
import { NormalizedNode } from '../ast/normalized-node';

export class ExampleCustomAnalyzer implements Analyzer {
    readonly name = 'example-custom';

    analyze(file: string, ast: NormalizedNode, rawLines: string[]): Finding[] {
        const findings: Finding[] = [];

        // Traverse NormalizedNode tree and match target feature (single function CC <= 15)
        ast.walk((node) => {
            if (node.kind === 'FunctionDeclaration' && node.text.includes('deprecatedOp')) {
                findings.push({
                    ruleId: 'GUARD-AST-001',
                    file,
                    line: node.startLine,
                    column: node.startColumn,
                    severity: Severity.WARNING,
                    message: 'Use of deprecated operation detected.',
                    suggestion: 'Migrate to the modern unified operator.',
                    dimension: 'technical_debt',
                });
            }
        });

        return findings;
    }
}
