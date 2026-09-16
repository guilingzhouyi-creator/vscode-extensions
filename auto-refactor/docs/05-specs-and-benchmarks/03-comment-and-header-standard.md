# 注释与文件头工业契约标准 (Comment & Header Standard) v1.0.0

> **适用范围**：`src/**/*.ts` 与 `scripts/*.js`。`scripts/.corpus/**` 为等价性验证的逆向夹具语料（内含故意违规样本），永久豁免。
> **契约真源**：判定逻辑 `src/analyzers/comments.ts`，字段与文案 `src/core/messages/comments.ts`，配置级联 `src/core/config.ts`。
> **强制门禁**：`npm run gate`（`lint` + `format:check` + `gate:comments` + `build` + `npm test`）。

---

## 一、语言与格式基线 (Language & Format)

| 维度 | 规则 | 判定方式 |
| :--- | :--- | :--- |
| 注释语言 | **英文单语**；禁止新增中文/日文等 CJK 注释（`src/core/messages/comments.ts` 中的中文字段常量属于契约数据，豁免） | 人工审查 + `npm run lint` |
| 行宽 | 代码与注释 **≤ 100 列** | Prettier `printWidth: 100` + `CMT-WID-001`（工具指令行豁免） |
| 缩进 | TypeScript **4 空格**、JavaScript/脚本 **2 空格**（对齐 AGENTS.md §4.1），禁用 Tab | Prettier `tabWidth` + 覆盖规则 |
| 引号与分号 | 单引号；语句尾分号；多行尾随逗号 | Prettier |
| 换行符 | LF | Prettier `endOfLine: lf` |
| 分隔线 | 同一文件内风格自洽：短分隔 `// ── 标题 ──` 或长分隔 `// ──────` 二选一，禁止混用；裸分隔线（上下无标题）允许 | `CMT-SEP-001`（语言无关） |
| 编码 | 禁止 mojibake（替换符 / UTF-8 误按 Latin-1 解码 / 智能引号乱码） | `CMT-MOJI-001`（error，`basic` 起） |
| 文件横幅 | 不足 150 行的小文件禁用 `═` 文件级横幅 | `CMT-BAN-001` |
| 禁止标记 | 严禁 `TODO` / `FIXME` / `XXX` / `HACK` 与施工批次黑话（`Phase NN`、`pNN`、`wip`、`临时`） | `hygiene` 分析器 `HYG-STB-001/002` |

---

## 二、六字段文件头契约 (Six-Field File Header)

每个文件**首 30 行内**必须存在完整注释块，且包含以下六个字段（大小写不敏感，判定为子串匹配）。

| # | 字段 (Field) | 语义 | 写作要求 |
| :---: | :--- | :--- | :--- |
| 1 | `Module:` | 模块归属域 | 该文件属于哪个职责域（如 Core Engine / CLI / Verification Harness） |
| 2 | `File Path:` | 物理路径 | **仓库根相对 POSIX 路径**，必须与真实路径一致（CMT-HDR-003，error 级） |
| 3 | `Architecture Role:` | 架构定位 | 分层定位与在数据流中的角色（入口/编排/适配器/单源契约） |
| 4 | `Dependencies & Triggers:` | 依赖与触发 | 上游/下游模块与触发时机（CLI / CI / post-scan / 守护进程） |
| 5 | `Responsibilities:` | 职责说明 | 必须覆盖的职责清单；一条职责对应一个可验证行为 |
| 6 | `Exit Semantics & Design Rationale:` | 退出语义与设计依据 | 成功/失败/降级语义 + 第一性原理依据（为何这样设计，而非实现复述） |

**标准模板（TypeScript）**

```ts
/**
 * Module: Core Engine — Declarative Configuration Resolution
 * File Path: src/core/config.ts
 * Architecture Role: Configuration single source of truth; read by every entry point
 * Dependencies & Triggers: CLI --config / auto-discovery / daemon startup
 * Responsibilities: Layered merge (defaults < file < CLI), analyzer registry merge,
 *                    comment/security level cascade, scale & maturity auto-tuning
 * Exit Semantics & Design Rationale: Never throws on malformed config; falls back to
 *                    defaults with a warning (fail-soft) so CI never dies on a broken file.
 */
```

**标准模板（Node.js 脚本）**

```js
#!/usr/bin/env node
/**
 * Module: Verification Harness — Generalized Capability Equivalence Checks
 * File Path: scripts/validate-generalized.js
 * ...
 */
```

**判定细节（与引擎实现一致）**

* 头部扫描窗口为文件**首个 30 行**；`#!` shebang 行不计为注释，但计入窗口。
* 头块缺失 → `CMT-HDR-001`（strict 档为 warning）。
* 字段缺失 → `CMT-HDR-002`（warning，逐字段报告）。
* `File Path` 与扫描期路径不一致 → `CMT-HDR-003`（error，直接阻断）。

---

## 三、公有 API 文档契约 (Public API JSDoc)

**必须**为以下声明提供紧邻注释（中间不得有空行）：`export function` / `export class` / `export interface` / `export type` / `export enum` / `export const|let|var`，以及 `class` / `func` / `def` / `pub fn` 等跨语言公有声明。

1. **紧邻性**：注释块与声明之间不得有空行或非装饰器代码，否则 `CMT-DOC-001`（strict 档 warning）。
2. **语义增量**：文档不得是符号名的机械复述（如 `/** calculateTotal */`）→ `CMT-DOC-002`（warning）。
3. **参数与返回值**：带参数或返回值的函数应写明 `@param` / `@returns`；异常路径写明 `@throws`。ESLint `jsdoc/*` 规则兜底校验。
4. **并发语义**：`async` 声明必须在注释中显式说明并发/重入语义（关键词之一：`async`、`await`、`thread`、`reentrant`、`idempotent`、`lock`、`mutex`、`atomic`、`race`、`sync`）→ 否则 `CMT-CON-001`（strict 档 info，本次规范化一并清零）。
5. **导出常量/类型**：一句话说明其契约含义与取值边界；避免复述字面量。

**推荐写法**

```ts
/**
 * Resolve the final scan config by layering defaults, the config file, and CLI overrides.
 *
 * @param overrides - CLI/API overrides; `analyzers` acts as an explicit allow-list.
 * @returns The merged immutable scan config; never throws on a malformed config file.
 */
export function resolveConfig(overrides: ConfigOverrides = {}): ScanConfig {}
```

---

## 四、私有实现注释 (Internal Comments)

* **只写 why**：算法选择、边界条件、反直觉行为的成因；禁止复述代码的 what。
* **失效即删**：注释与实现漂移时同步修正或删除；禁止留存过期表述与死注释。
* **私有 helper**：非导出 helper 至少保留一行意图说明（推荐，非门禁强制项）。

---

## 五、门禁与棘轮 (Gate & Ratchet)

| 命令 | 内容 | 失败语义 |
| :--- | :--- | :--- |
| `npm run format:check` | Prettier 全量格式校验 | 非 0 即阻断 |
| `npm run lint` | ESLint（typescript-eslint + jsdoc + prettier 冲突消解） | 非 0 即阻断 |
| `npm run gate:comments` | 自举 strict 注释门禁，对照 `baselines/comments.strict.baseline.json` | 新增项 ≥ warning 即阻断 |
| `npm run gate` | 上述三项 + `build` + `npm test` | 任一失败即阻断 |

**棘轮纪律**

* 基线为 `--baseline-granularity grouped`（`analyzer｜rule｜file` 计数），对行号漂移免疫。
* 只允许**单调下降**：每批次清理后执行
  `node dist/index.js scan --root . --include "src/**/*.ts,scripts/*.js" --analyzers comments --comment-level strict --baseline baselines/comments.strict.baseline.json --update-baseline baselines/comments.strict.baseline.json --no-cache --no-daemon`
  重新固化。
* 严禁手工编辑基线文件消音新增违规；基线内容必须可由上述命令复现。
* 终态目标：基线为空（0 组），即全域 125 个文件在 strict 档零新增、零存量。

---

## 六、新增/改造文件检查清单 (Checklist)

- [ ] 头注释六字段齐全，`File Path` 与物理路径一致
- [ ] 公有声明具备语义化 JSDoc（含 `@param` / `@returns` / 并发语义）
- [ ] 注释为英文，行宽 ≤ 100，无 `TODO`/批次黑话
- [ ] `npm run format` 与 `npm run lint` 通过
- [ ] `npm run gate:comments` 无新增（如已清理存量，同步 `--update-baseline` 收敛基线）
