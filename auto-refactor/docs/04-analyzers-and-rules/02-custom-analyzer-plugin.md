# 02. 自定义分析器插件与语义模式扩展规范

> **所属层级**：L4 规则引擎与内置分析器 (`docs/04-analyzers-and-rules/`)  
> **对应代码真源**：`src/core/analyzer-registry.ts`、`src/core/patterns/`、`src/core/types.ts`、`src/core/scoring/dimensionRuleTable.ts`

---

## 1. 插件扩展双模态架构

除了内置的 26 个分析器包与 243 条规则外，`auto-refactor` 支持第三方团队通过两种方式无侵入扩展自定义审查规则：

1. **声明式语义模式核（Declarative Pattern Kernel，`src/core/patterns/`）**：无需编写 AST 遍历逻辑，通过声明符号特征、调用接收者、控制流位置（如「是否处于循环内」、「是否处于 catch 块内」）即可快速定义跨语言检查规则。
2. **编程式 `Analyzer` 插件接口（Programmatic Analyzer Plugin，`src/core/types.ts`）**：实现标准 `Analyzer` 接口，直接访问 `NormalizedNode`、`SemanticGraph`、`ControlFlowGraph` 与 `DataFlowGraph`。

---

## 2. 标准 `Analyzer` 插件契约

```ts
export interface AnalyzerContext {
    readonly filePath: string;
    readonly content: string;
    readonly maskedContent: string;
    readonly language: SupportedLanguage;
    readonly ast?: NormalizedNode;
    readonly config: ScanConfig;
    readonly semanticGraph?: SemanticGraph;
}

export interface Analyzer {
    readonly name: string;
    analyze(context: AnalyzerContext): Promise<Issue[]> | Issue[];
}
```

### 2.1 编写自定义分析器示例

```ts
import type { Analyzer, AnalyzerContext, Issue } from 'auto-refactor';

export const CustomDomainBoundaryAnalyzer: Analyzer = {
    name: 'custom-domain-boundary',
    analyze(ctx: AnalyzerContext): Issue[] {
        const issues: Issue[] = [];
        if (!ctx.filePath.startsWith('src/ui/')) return issues;

        const lines = ctx.maskedContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('from "../database/')) {
                issues.push({
                    id: `custom-domain-boundary:CUS-LAY-001:${ctx.filePath}:${i + 1}`,
                    rule: 'CUS-LAY-001',
                    analyzer: 'custom-domain-boundary',
                    severity: 'error',
                    message: 'UI module must not directly import database persistence layer.',
                    location: {
                        file: ctx.filePath,
                        startLine: i + 1,
                        endLine: i + 1,
                    },
                    suggestion: 'Route data access through an application service or snapshot DTO.',
                });
            }
        }
        return issues;
    },
};
```

---

## 3. 缓存安全性与评分联动规范

1. **L2 缓存安全隔离 (`cacheCustom`)**：
   - 默认情况下，外部注入的自定义分析器仅参与 `L1` 内存单次运行，不写入 `L2` 磁盘持久化缓存，防止插件代码修改后命中旧结果。
   - 当插件为纯函数且无外部文件读取副作用时，可在 `ScanOptions` 中设置 `cacheCustom: true`，引擎会自动对插件源码计算哈希并混入 `CacheKey`。
2. **接入十维质量评分 (`dimensionRuleTable.ts`)**：
   - 自定义分析器产出的 `Issue` 默认通过严重度回退机制计入 `techDebtRisk` 维度扣分；
   - 如需将特定规则绑定至 `architecture`、`security` 或 `performance` 等专门质量支柱，可在 `dimensionRuleTable.ts` 中新增映射表项，并通过 `npm run validate-scoring-coverage` 门禁验证。

---

## 4. 关联文档导航

- [01. 四层规则金字塔、26 个内置分析器与 243 条全量规则字典](./01-builtin-rules.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](../05-specs-and-benchmarks/07-quantified-quality-standard.md)
