# 03. 工业级文件头与有效注释密度 (ECD-C) 规范

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`src/core/comments/`、`src/analyzers/comments.ts`、`scripts/gate-comments.js`、`scripts/validate-comment-hygiene.js`

---

## 1. 六字段模块文件头契约 (`CMT-HDR-001`)

在 `commentLevel: 'standard'` 及以上档位，每一个核心源码文件顶部必须具备包含以下六个标准语义字段的 JSDoc / 模块文档头，使人类开发者与 LLM Agent 无需通读全文即可建立准确的架构心智模型：

```ts
/**
 * Module: <所属子系统与模块名称>
 * File Path: <仓库相对路径，POSIX 斜杠>
 * Architecture Role: <在六层架构或领域中的职责定位>
 * Dependencies & Triggers: <上下游依赖模块与调用触发时机>
 * Responsibilities: <核心职责清单与不变量约束>
 * Exit Semantics & Design Rationale: <异常/退出语义及核心设计取舍理由>
 */
```

---

## 2. 有效注释密度模型 (Effective Comment Density — ECD-C)

传统「注释行数 / 代码行数」指标极易被无意义的样板注释、被注释掉的死代码或分隔符横幅刷高。`src/core/comments/` 实现了基于信息熵与结构语义的 **有效注释密度（ECD-C）** 评估算法：

1. **高价值注释加权（Positive Signal）**：
   - 解释「为什么（Why）」的设计权衡、并发不变量（Concurrency Contract）、复杂度来源说明、公有导出 API 的 `@param` / `@returns` / `@throws` 契约均计入有效注释分子。
2. **噪声与反模式剔除（Noise Filtering & Penalties）**：
   - **`CMT-BAN-001`（过度装饰横幅）**：不足 150 行的小文件滥用 `══════` 装饰横幅不仅不计入有效密度，反而触发警告；
   - **`CMT-DEAD-001`（注释掉的死代码）**：包含语句块结构的废弃代码注释直接判定为卫生违规；
   - **`CMT-MOJI-001`（乱码与损坏编码）**：包含 UTF-8 解码替换符 `\uFFFD` 或常见 Mojibake 字符序列的注释立即拦截；
   - **`HYG-STB-002`（遗留施工黑话与空洞 TODO）**：拦截缺少上下文或包含临时批次黑话的占位注释。

---

## 3. 四档注释审计等级 (`CommentLevel`)

| 档位 (`commentLevel`) | 适用项目阶段 | 强制执行的检查集 |
| :--- | :--- | :--- |
| **`off`** | 临时脚手架 / 外部第三方生成代码 | 关闭全部注释类规则 |
| **`basic`** | 原型验证 (`prototype`) | 仅拦截乱码 (`CMT-MOJI-001`)、死代码注释与空洞占位符 |
| **`standard`（默认）** | 生产级工程 (`production`) | 强制六字段模块头、公有导出符号 JSDoc、ECD-C 密度下限与小文件横幅禁令 |
| **`strict`** | 工业级核心基座 (`industrial`) | 额外要求内部复杂算法函数（CC $\ge 12$）必须显式注明时间复杂度与边界不变量 |

---

## 4. 注释门禁棘轮 (`npm run gate:comments`)

`scripts/gate-comments.js` 作为 `npm run gate` 的必经环节，对全仓源码执行注释一致性扫描：任何新增文件缺失六字段头或新增导出函数缺失 JSDoc 契约，门禁立即以非零退出码阻断提交。

---

## 5. 关联文档导航

- [01. 四层规则金字塔、26 个内置分析器与 243 条全量规则字典](../04-analyzers-and-rules/01-builtin-rules.md)
- [07. 三平面质量量化模型与代码自治度 (CAI) 规范](./07-quantified-quality-standard.md)
