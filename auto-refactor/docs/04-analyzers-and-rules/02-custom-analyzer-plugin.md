# 自定义分析器插件扩展契约 (Custom Analyzer Plugin Contract)

> **所属模块**：`04-analyzers-and-rules`  
> **核心源码**：`src/core/types.ts`, `src/core/config.ts`, `src/core/scanner/analyzerRunner.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 插件架构契约

`auto-refactor` 支持以声明式方式编写与接入外部自定义分析器插件：

```typescript
export interface Analyzer {
  /** 插件唯一命名标识符 */
  name: string;
  /** 可选：生命周期初始化钩子 */
  initialize?(config: ResolvedConfig): Promise<void> | void;
  /** 可选：基于通用 NormalizedNode 的流式访问钩子 */
  visitNode?(node: NormalizedNode, ctx: AnalyzerContext): void;
  /** 可选：文件扫描终态评估与诊断产出 */
  finalize?(ctx: AnalyzerContext): Issue[];
  /** 兼容传统 TypeScript AST 深度分析接口 */
  analyze?(sourceFile: ts.SourceFile, ctx: AnalyzerContext): Issue[];
}
```

---

## 2. 插件注册与配置 (`ar.config.json`)

在项目配置文件 `ar.config.json` 中声明 `customAnalyzers`：

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

* **独立哈希隔离**：L2 缓存引擎自动计算自定义插件源码文件的 SHA-256 哈希，并融入配置指纹。当插件源码改动时，受影响的分析缓存将自动隔离重建，绝不产生脏缓存。
