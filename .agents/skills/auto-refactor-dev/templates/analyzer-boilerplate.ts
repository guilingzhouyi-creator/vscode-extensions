import { Analyzer, Finding, Severity } from '../types';
import { NormalizedNode } from '../ast/normalized-node';

export class ExampleCustomAnalyzer implements Analyzer {
    readonly name = 'example-custom';

    analyze(file: string, ast: NormalizedNode, rawLines: string[]): Finding[] {
        const findings: Finding[] = [];

        // 遍历统一语法树节点并匹配目标特征
        ast.walk((node) => {
            if (node.kind === 'FunctionDeclaration' && node.text.includes('deprecatedOp')) {
                findings.push({
                    ruleId: 'GATE-AST-001',
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
