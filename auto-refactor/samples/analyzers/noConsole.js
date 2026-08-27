// External analyzer plug-in — registered declaratively via customAnalyzers[].module.
// Demonstrates the "no code change to the engine" plug-in model.
// Implements the duck-typed Analyzer contract: { name: string, analyze(sf, ctx) -> Issue[] }.
//   - ctx.options  : merged global thresholds + this analyzer's own options
//   - ctx.filePath : relative path (for Issue.id / location.file)
//   - sf.fileName  : absolute path set by the engine (use ctx.filePath for display)

const ts = require('typescript');

function loc(sf, node) {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

class NoConsoleAnalyzer {
  name = 'no-console';

  analyze(sf, ctx) {
    const issues = [];
    const allowed = new Set(ctx.options.allowed || []); // e.g. ["error"] to tolerate console.error
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'console'
      ) {
        const method = node.expression.name.text;
        if (!allowed.has(method)) {
          issues.push({
            id: `no-console:no-console-call:${ctx.filePath}:${loc(sf, node).start.line}`,
            analyzer: 'no-console',
            rule: 'no-console-call',
            severity: ctx.options.severity || 'warning',
            message: `Avoid console.${method}() in committed code.`,
            location: { file: ctx.filePath, ...loc(sf, node) },
            detail: { method },
            suggestion: `Remove console.${method}() or route through a structured logger.`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return issues;
  }
}

module.exports = NoConsoleAnalyzer;
