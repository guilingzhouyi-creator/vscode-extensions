# 自定义分析器插件扩展契约 (Custom Analyzer Plugin Contract)

> **所属模块**：`04-analyzers-and-rules`  
> **核心源码**：`src/core/types.ts`, `src/core/config.ts`, `src/core/analyzer.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 插件架构契约

`auto-refactor` 支持开发者编写外部自定义插件，以声明式的方式接入引擎的扫描流水线：

```typescript
export interface Analyzer {
  name: string;
  /** 可选：基于通用 NormalizedNode 的流式访问钩子 */
  visitNode?(node: NormalizedNode, ctx: AnalyzerContext): void;
  finalize?(ctx: AnalyzerContext): Issue[];
  /** 兼容传统 TypeScript AST 深度分析 */
  analyze?(sourceFile: ts.SourceFile, ctx: AnalyzerContext): Issue[];
}
```

---

## 2. 插件注册与配置 (`auto-refactor.config.json`)

在项目配置文件中声明 `customAnalyzers`：

```json
{
  "customAnalyzers": [
    {
      "name": "no-inline-regex",
      "path": "./rules/no-inline-regex.js",
      "enabled": true,
      "options": {
        "allowComments": false
      }
    }
  ]
}
```

* **独立哈希追踪**：L2 缓存引擎自动跟踪自定义插件 `.js` 文件的内容哈希，当插件源码改动时，受影响的分析缓存将自动失效重建。
