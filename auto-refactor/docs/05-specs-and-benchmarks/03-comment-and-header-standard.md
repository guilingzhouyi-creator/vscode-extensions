# 03. 规范文件头与有效注释密度 (ECD-C) 规范

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：[`comments`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/comments/)、[`comments.ts`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/analyzers/comments.ts)、[`gate-comments.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/gate-comments.js)、[`validate-comment-hygiene.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/validate-comment-hygiene.js)

---

## 1. 六字段模块文件头契约 (`CMT-HDR-001`)

在内置 **30 个分析器** 与 **325 条全量规则体系** 中，注释分析器 (`comments`) 负责执行严格的代码可读性与文档治理。当配置处于 `commentLevel: 'standard'`（默认）及以上档位时，每一个核心源码文件顶部必须具备包含以下六个标准语义字段的 JSDoc / 模块文档头，使人类协作者与 AI 智能体无需遍历全文件即可建立精确的架构心智模型：

```ts
/**
 * Module: <所属子系统与模块名称>
 * File Path: <仓库相对路径，POSIX 斜杠>
 * Architecture Role: <在系统分层架构或领域中的职责定位>
 * Dependencies & Triggers: <上下游依赖模块与调用触发时机>
 * Responsibilities: <核心职责清单与关键不变量约束>
 * Exit Semantics & Design Rationale: <异常/退出语义及核心设计取舍理由>
 */
```

- 若核心源文件缺少上述六字段头或字段名残缺，将直接触发 [`CMT-HDR-001`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/analyzers/comments.ts) 违规。

---

## 2. 有效注释密度模型 (Effective Comment Density — ECD-C)

传统基于「注释物理行数 / 源码总行数」的简易度量极易被无意义的样板代码、被注释掉的死代码或大面积装饰横幅恶意刷分。[`src/core/comments/`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/src/core/comments/) 实现了基于信息熵与结构语义的 **有效注释密度（ECD-C）** 评估算法：

### 2.1 高价值有效注释信号 (Positive Signal)
- 解释「为什么（Why）」的设计权衡与不变量说明；
- 复杂并发算法状态机流转契约（Concurrency Contract）；
- 控制流与循环复杂度来源分析；
- 导出公有 API 的 `@param`、`@returns`、`@throws` 类型与前置条件说明。

### 2.2 真实注释与卫生违规规则矩阵 (Real Violation Rules)

任何低信息熵噪声、损坏编码或反模式不仅不计入 ECD-C 分子，反而会触发对应的真实分析器违规：

| 规则标识 ID | 规则名称 | 所属分析器 | 违规场景与治理依据 |
| :--- | :--- | :---: | :--- |
| **`CMT-HDR-001`** | `missing-module-header` | `comments` | 核心源文件头部缺少标准六字段模块头契约或字段不完整 |
| **`CMT-BAN-001`** | `excessive-banner-comment` | `comments` | 在不足 150 行的小文件内滥用 `══════` 或 `******` 占位横幅装饰 |
| **`CMT-DEAD-001`** | `commented-out-dead-code` | `comments` | 将被废弃的语句块、函数或类定义通过注释遗留在源码中 |
| **`CMT-MOJI-001`** | `mojibake-comment-detected` | `comments` | 注释中包含 UTF-8 解码替换字符 `\uFFFD` 或异常乱码字符序列 |
| **`HYG-STB-002`** | `empty-stub-comment` | `hygiene` | 包含缺少上下文或包含临时批次施工黑话的空洞 TODO/FIXME 占位注释 |

---

## 3. 四档注释审计等级 (`CommentLevel`)

| 审计档位 (`commentLevel`) | 适用项目场景 | 强制激活的检查范围 |
| :--- | :--- | :--- |
| **`off`** | 第三方 Vendor 库 / 自动生成代码 | 关闭全部注释类分析器与规则 |
| **`basic`** | 早期技术原型验证 (`prototype`) | 仅拦截损坏乱码 (`CMT-MOJI-001`)、废弃死代码与空洞占位符 |
| **`standard`（默认）** | 生产级工程与日常迭代 (`production`) | 强制执行六字段模块头 (`CMT-HDR-001`)、小文件横幅禁令与 ECD-C 密度下限 |
| **`strict`** | 关键工业基座与核心库 (`industrial`) | 额外要求内部高复杂度函数（CC $\ge 10$）必须显式标注算法复杂度与边界条件 |

---

## 4. 注释门禁棘轮 (`npm run gate:comments`)

在持续集成流水线中，[`scripts/gate-comments.js`](file:///c:/CODE_game-development/vscode-extensions/auto-refactor/scripts/gate-comments.js) 作为 `npm run gate` 的必经硬门禁执行：

1. **新增文件全量检验**：任何新加入的代码文件若缺少六字段模块头，立即以非零退出码阻断；
2. **符号文档覆盖率看守**：公共导出类型与接口必须具备 JSDoc 契约；
3. **单向收紧防止腐化**：确保全仓注释卫生质量水位只升不降。

---

## 5. 关联文档导航

- [01. 配置模式与多格式报告契约](./01-config-and-reports.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
