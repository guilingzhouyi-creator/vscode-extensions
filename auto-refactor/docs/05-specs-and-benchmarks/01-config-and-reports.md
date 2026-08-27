# 配置规范与报告输出格式 (Configuration & Report Formats)

> **所属模块**：`05-specs-and-benchmarks`  
> **核心源码**：`config.schema.json`, `report.schema.json`, `src/formatters/*`, `src/core/config.ts`  
> **文档状态**：✅ **已落地实施 (Implemented & Verified)**

---

## 1. 配置文件模式 (`auto-refactor.config.json`)

引擎提供完整的 JSON Schema 校验支持（`config.schema.json`）：

```json
{
  "$schema": "./config.schema.json",
  "root": "src",
  "include": ["**/*.ts", "**/*.js", "**/*.rs"],
  "exclude": ["**/node_modules/**", "**/dist/**"],
  "thresholds": {
    "magicNumberMin": 2,
    "hardcodedStringMinLength": 3,
    "duplicateLiteralThreshold": 3,
    "complexityWarn": 10,
    "complexityFail": 20,
    "maxFileLines": 500,
    "maxFunctionLines": 80
  },
  "format": "json",
  "failOnIssue": false
}
```

---

## 2. 输出报告格式 (Output Formats)

引擎内置多种标准输出格式化程序：

| 格式标识 (`--format`) | 输出特性 | 适用场景 |
| :--- | :--- | :--- |
| **`json`** (默认) | 结构化完整 JSON 树，包含全量汇总、文件指标与问题详情。 | CI 自动化脚本解析、跨工具集成 |
| **`sarif`** | OASIS 标准静态分析结果交换格式 (SARIF v2.1.0)。 | GitHub Code Scanning / 安全面板直接展示 |
| **`text`** | 彩色终端高亮排版，附带文件名、行号、代码建议与摘要表格。 | 开发者本地 CLI 手动执行 |
| **`compact`** | 单行精简格式 (`file:line:col: [severity] rule: message`)。 | 类 Unix 管道过滤 (`grep` / `awk`) |
