# auto-refactor `CMP-*` / `IssueEvidence` 完善改造计划

> 依据：《auto-refactor 在途改动质量审查报告》（`deliverables/auto-refactor-CMP-review.md`）
> 基线：`compressionBounds.ts` sha1 `5f1637f7b7f2`、`scripts/validate-compression-bounds.js` sha1 `e66306469d3c`（开工前先复核，见 §9）
> 计划日期：2026-09-15

---

## 0. 目标与三条不可违反的约束

| 目标 | 衡量方式 |
| :--- | :--- |
| G1 消除 `CMP-*` 对注释/正则/类型语法的误报 | 在本项目 `src` 上 `CMP-*` 命中数由 16 → **0**（1 条待决项见 §9-1） |
| G2 让验证 harness 具备可失败性 | 删空任一条 CMP 规则，`validate-compression` **必须变红** |
| G3 让 `summary.uncertainty` 语义诚实且始终自洽 | 无 evidence ⇒ 无 `averageConfidence`；post-scan 追加后不变量仍成立 |

**约束 A（字节级等价）**：本项目以"改动不得改变既有产出"为准入门槛。任何触及共享代码的行为变更，都必须证明其它调用方输出逐字节不变。
**约束 B（范围 ≤ 已证范围）**：语言声明不得超出已有夹具覆盖范围。
**约束 C（先只读后动手）**：每个阶段开工前先跑该阶段对应的复现探针，确认缺陷仍存在；避免在已被并发修复的残留上做无用功（本次审查期间已发生过一次工作树被外部改动）。

---

## 1. 变更清单总表

| # | 文件 | 动作 | 阶段 | 风险 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `src/core/governance/codeView.ts`（新增） | 新的"代码视图"构建器：`maskSourceText` + 正则字面量掩码 | A | 低（新文件，无既有调用方） |
| 2 | `src/core/governance/types.ts` | `RuleEvaluationContext` 增可选字段 `masked?: string[]` | A | 低（可选、附加） |
| 3 | `src/analyzers/governance.ts` | `ensureInitialized` 计算并缓存 `codeView`；两处 evalCtx 注入 `masked` | A | 中（分析器主路径，需复跑全量门禁） |
| 4 | `src/core/governance/rules/compressionBounds.ts` | 删除 3 个行级清洗函数；四条规则改消费 `ctx.masked`；语言收窄；摘除错误 evidence | A+C | 中（规则语义变更，需新夹具锁定） |
| 5 | `src/core/rules/entries/governance.ts` | 4 处 `ALL_LANGUAGES` → `[LANGUAGE_TYPESCRIPT, 'javascript']`；`'CMP'` 提为常量；修正失效注释 | A+D | 低 |
| 6 | `scripts/validate-compression-bounds.js` | 重写 `[3/3]` 为真误报率；新增负样本语料；断言加**上界** | B | 低 |
| 7 | `src/core/uncertainty.ts`（新增） | 从 `analyzer.ts` 提为共享纯函数 | C | 低 |
| 8 | `src/core/analyzer.ts` | 删除私有 `summarizeUncertainty`，改 import | C | 低 |
| 9 | `src/api.ts` | `recomputeSummary` 补算 `uncertainty` | C | 低 |
| 10 | `src/analyzers/comments.ts` | `CMT-CON-001` 摘除 `requiresRuntime` | C | 低 |
| 11 | `report.schema.json` | `uncertainty` 补 `required` + `additionalProperties: false`；`averageConfidence` 改可选 | C | 低 |
| 12 | `docs/04-analyzers-and-rules/01-builtin-rules.md` | 第 17 节补"默认关闭""当前仅 TS/JS" | D | 低 |
| 13 | `package.json` | `test` 链中 `validate-compression` 前移至 governance 域附近 | D | 低 |

**不做**：不改 `src/core/sourceMask.ts`、不改 `src/analyzers/{pythonModern,tsModern,rustModern,gdscriptModern}.ts`、不改 `family: 'CMP'` 的分族决策、不重构 `npm test` 的 32 段命令链结构（仅做一次前移）。

---

## 2. 阶段 A —— 词法掩码层重建（修 P0-1）

### 2.1 设计决策与理由

| 方案 | 做法 | 结论 |
| :--- | :--- | :--- |
| **A（采纳）** | 保持 `sourceMask.ts` 不动；新增 governance 层 `codeView.ts`，组合"共享掩码 + CMP 自有正则掩码" | 爆炸半径最小：4 个语言包输出逐字节不变 |
| B（不采纳） | 给 `SourceMaskConfig` 加 `regexLiterals?: boolean`，在 `sourceMask.ts` 内实现 | 触及 4 个语言包共用的核心 helper，需重新验证全部语言包输出；且其文件头 `:14-16` 明确把"不建模正则"声明为有意取舍，改它应作为独立议题审议 |

> 附带发现（需登记，不在本计划修复范围内）：`src/core/sourceMask.ts:14-16` 的注释断言"正则字面量不建模"只牺牲"rare false positive"。本次实测在 16 条命中中有 6 条由正则字面量直接造成（37.5%），该前提已被数据推翻。建议作为独立议题评估方案 B，本轮先不动。

### 2.2 步骤 A1：新增 `src/core/governance/codeView.ts`

```ts
/**
 * Module: Core Governance — Code View Builder
 * File Path: src/core/governance/codeView.ts
 * Architecture Role: Builds the per-file "code view" consumed by content-oriented governance
 *     rules: a same-length masked copy of every line in which comments, string/template
 *     literals and regular-expression literals are blanked, so rules never inspect prose.
 * Dependencies & Triggers: core sourceMask helper plus governance language ids; called once
 *     per file from GovernanceAnalyzer.ensureInitialized.
 * Responsibilities: Map a language id to its comment/quote syntax, reuse maskSourceText for
 *     the cross-line comment/string state, then blank regex literals on the already-masked
 *     line so `/` inside a string can never start a false regex run.
 * Exit Semantics & Design Rationale: Pure and total — same length in, same length out, so
 *     reported columns keep pointing at the real source; an unterminated regex blanks the
 *     remainder of the line (fail-safe: a missed match beats a wrong suggestion).
 */
import { maskSourceText, type SourceMaskConfig } from '../sourceMask';

/** Language ids published by governance `languageProfiles`. */
const LANGUAGE_TYPESCRIPT = 'typescript';
const LANGUAGE_JAVASCRIPT = 'javascript';
const LANGUAGE_GDSCRIPT = 'gdscript';
const LANGUAGE_PYTHON = 'python';
const LANGUAGE_RUST = 'rust';
const LANGUAGE_SHELL = 'shell';
const LANGUAGE_POWERSHELL = 'powershell';

/**
 * Masking syntax per governance language id.
 *
 * Quote sets deliberately mirror each language pack's own choice so one language never gets
 * two different masking policies: Rust omits `'` (char literals and lifetimes would otherwise
 * swallow the rest of the line, as documented in rustModern.ts).
 */
const MASK_BY_LANGUAGE: Record<string, SourceMaskConfig> = {
    [LANGUAGE_TYPESCRIPT]: {
        lineComment: '//',
        blockComment: { open: '/*', close: '*/' },
        quoteChars: "'\"`",
        multilineTemplates: true,
    },
    [LANGUAGE_JAVASCRIPT]: {
        lineComment: '//',
        blockComment: { open: '/*', close: '*/' },
        quoteChars: "'\"`",
        multilineTemplates: true,
    },
    [LANGUAGE_GDSCRIPT]: { lineComment: '#', quoteChars: "'\"`" },
    [LANGUAGE_PYTHON]: { lineComment: '#', quoteChars: "'\"" },
    [LANGUAGE_RUST]: {
        lineComment: '//',
        blockComment: { open: '/*', close: '*/' },
        quoteChars: '"',
    },
    [LANGUAGE_SHELL]: { lineComment: '#', quoteChars: "'\"" },
    [LANGUAGE_POWERSHELL]: {
        lineComment: '#',
        blockComment: { open: '<#', close: ' #>' },
        quoteChars: "'\"",
    },
};

/** Fallback syntax for language ids this table does not know. */
const DEFAULT_MASK: SourceMaskConfig = {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/' },
    quoteChars: "'\"`",
    multilineTemplates: true,
};

/** Characters that, immediately before a `/`, mean the slash opens a regex literal. */
const REGEX_PREFIX_CHARS = '([{,=:!&|?;+-*%<>';

/** Regex flags consumed after the closing slash. */
const REGEX_FLAG_RE = /[a-z]/i;

/**
 * Build the masked code view for one file.
 *
 * @param content - Raw file content.
 * @param languageId - Governance language id (from LanguageCapabilities.languageId).
 * @returns One masked string per line, same length as the raw line.
 */
export function buildCodeView(content: string, languageId: string): string[] {
    const config = MASK_BY_LANGUAGE[languageId] ?? DEFAULT_MASK;
    const { masked } = maskSourceText(content, config);
    // Regex literals are modelled here, after strings and comments are already blank, so the
    // `/`-vs-division decision only ever sees real code positions.
    return masked.map((line) => maskRegexLiterals(line));
}

/**
 * Blank regex literals on one already-comment/string-masked line.
 *
 * @param line - Line whose strings and comments are spaces.
 * @returns Same-length line with regex bodies blanked.
 */
function maskRegexLiterals(line: string): string {
    if (line.indexOf('/') === -1) return line;
    const out = line.split('');
    let index = 0;
    while (index < line.length) {
        if (line[index] !== '/' || line[index + 1] === '/') {
            index += 1;
            continue;
        }
        if (!opensRegexLiteral(line, index)) {
            index += 1;
            continue;
        }
        index = maskRegexBody(line, index, out);
    }
    return out.join('');
}

/**
 * Decide whether the slash at `index` opens a regex literal rather than dividing.
 *
 * @param line - Masked line.
 * @param index - Index of the `/`.
 * @returns True when the preceding non-blank character can only end a complete expression.
 */
function opensRegexLiteral(line: string, index: number): boolean {
    for (let back = index - 1; back >= 0; back -= 1) {
        const char = line[back];
        if (char === ' ' || char === '\t') continue;
        return REGEX_PREFIX_CHARS.indexOf(char) !== -1;
    }
    return true;
}

/**
 * Blank one regex literal and return the next index.
 *
 * @param line - Masked line.
 * @param index - Index of the opening `/`.
 * @param out - Character buffer being masked in place.
 * @returns Index of the next unprocessed character.
 */
function maskRegexBody(line: string, index: number, out: string[]): number {
    out[index] = ' ';
    let cursor = index + 1;
    let inClass = false;
    while (cursor < line.length) {
        const char = line[cursor];
        out[cursor] = ' ';
        if (char === '\\') {
            if (cursor + 1 < line.length) out[cursor + 1] = ' ';
            cursor += 2;
            continue;
        }
        if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) {
            cursor += 1;
            while (cursor < line.length && REGEX_FLAG_RE.test(line[cursor])) {
                out[cursor] = ' ';
                cursor += 1;
            }
            return cursor;
        }
        cursor += 1;
    }
    // Unterminated: the rest of the line stays blank so no operator can leak into a rule.
    return cursor;
}
```

### 2.3 步骤 A2：`RuleEvaluationContext` 增字段

`src/core/governance/types.ts`（当前 78-90 行）：

```ts
    /** Raw lines, indexed to match {@link masked}. */
    lines: string[];
    /**
     * Same-length masked copy of {@link lines} where comments, string literals and regex
     * literals are blanked. Content-oriented rules must read this view, never `lines`, or
     * they will inspect prose (JSDoc/usage text) as if it were code.
     */
    masked: string[];
```

**注意**：设为**必填**而非可选。理由——可选会让规则需要写 `ctx.masked ?? ctx.lines` 回退分支，等于把"误读原文"的风险留在代码里；必填则由编译器强制两个构造点（`visit` / `finalize`）都提供。改动面已确认只有 `src/analyzers/governance.ts:98-110` 与 `:131-141` 两处构造。

### 2.4 步骤 A3：分析器计算并注入（`src/analyzers/governance.ts`）

```ts
import { buildCodeView } from '../core/governance/codeView';

    private lines: string[] = [];
    private maskedLines: string[] = [];

    private ensureInitialized(ctx: AnalyzerContext): void {
        if (!this.capabilities) {
            this.capabilities = resolveLanguageProfile(ctx.filePath, ctx.adapter?.id);
            this.lines = ctx.content ? ctx.content.split(/\r?\n/) : [];
            this.maskedLines = ctx.content
                ? buildCodeView(ctx.content, this.capabilities.languageId)
                : [];
            // ...以下不变
        }
    }
```

两个 evalCtx 构造点各加一行 `masked: this.maskedLines,`（`visit` 与 `finalize`）。

**生命周期安全性已验证**：`analyzerRegistry.ts:55-61` 明确记载单遍多路复用路径**逐文件新建实例**（"instantiates per file so streaming analyzers never share mutable state across the concurrently scanned files handled by `pMap`"），因此把掩码缓存在实例字段上与既有 `this.lines` 完全同构，不存在跨文件污染。**当前实现已因逐文件新建而正确**，本步骤不引入新的状态风险。

### 2.5 步骤 A4：重写四条规则的取行逻辑（`rules/compressionBounds.ts`）

**删除**：`stripStringLiterals`（`:22-28`）、`stripRegexLiterals`（`:30-32`）、`sanitizeLine`（`:35-38`），以及 `CognitiveDensityRule` 的 `startsWith('*')` 特例守卫（`:264`）。

**统一替换为**（四条规则一致）：

```ts
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const violations: GovernanceViolation[] = [];
        const lines = ctx.lines;
        const masked = ctx.masked;

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            // The masked view is the only trustworthy code position: comments, strings and
            // regex literals are blanked, so a line that is pure prose drops out here.
            const clean = (masked[i] ?? '').trim();
            if (!clean) continue;
            // ...规则判据直接消费 `clean`，不再调用任何 strip*
            // 位置信息仍取 raw，掩码等长所以列号不偏移：
            // line: i + 1, column: raw.search(/\S/) + 1
        }
        return violations.length > 0 ? violations : null;
    }
```

要点：
- 删除 `type/interface/import/export type` 前缀豁免**不可行**——`export type Mode = 'a' | 'b' | ...` 掩码后仍是真实联合类型，仍会命中 `CMP-DEN-001`。故**保留**前缀豁免，但需按 A5 收紧 `hasBitwise`。
- `column` 一律用 `raw.search(/\S/) + 1`，**不要**改用 `clean` 的列位（掩码把首字符也变成空格）。

### 2.6 步骤 A5：收紧 `hasBitwise`（消除类型语法误报）

当前 `compressionBounds.ts:275-282`：

```ts
const hasBitwise = /[&|^~]|<<|>>/.test(clean);
```

问题：裸 `|` 同时匹配 TS 联合类型（`'a' | 'b'`）与 Rust 模式提升（`Some(x) | None`）；裸 `&` 匹配 TS 交叉类型。

**改为**：

```ts
// Bare `|`/`&` also spell TS union/intersection types and Rust pattern alternation, so they
// only count as bitwise when a strong bit operator is present on the same line. Accepted
// cost: a line whose only bitwise work is `&`/`|` is no longer reported (missed match beats
// a wrong suggestion, matching sourceMask.ts's stated trade-off).
const STRONG_BITWISE_RE = /<<|>>|\^|~/;
const WEAK_BITWISE_RE = /[&|]/;

const hasBitwise = STRONG_BITWISE_RE.test(clean) && WEAK_BITWISE_RE.test(clean)
    || STRONG_BITWISE_RE.test(clean);
```

> 上式可简化为 `STRONG_BITWISE_RE.test(clean)`；写作两段仅为在评审中显式保留"弱运算符需与强运算符共现"的意图。**最终实现请用简化式并由评审确认**。

**已验证的真阳性不受影响**：
- `const packed = (val<<3|mask>>2)&~flag^(offset+((bias?scale:factor)<<1));` → 含 `<<`、`>>`、`^`、`~` ✅ 仍命中
- `tsish.ts` 夹具同形 ✅
- Rust `let packed = (val & mask) | (offset << 2) ^ flag;` → 含 `<<`、`^` ✅ 仍命中（若语言收窄后本就不参与，见 A6）

**记录的漏报**：`(a & b) | c` 这类纯弱位运算行不再报告。需在文档第 17 节写明。

### 2.7 步骤 A6：语言声明收窄（修 P2-3）

**关键事实（修正上一轮报告的定位）**：运行时过滤由 `GovernanceRule.languages` 决定（`core/governance/registry.ts:127`：`if (rule.languages && !rule.languages.includes(languageId)) continue;`），而 `GovernanceRegistry` 仅从 `BUILTIN_GOVERNANCE_RULES`（即 `rules/*.ts` 的对象）播种，**完全不读** `entries/governance.ts`。所以：

| 层 | 当前状态 | 运行时是否有影响 |
| :--- | :--- | :--- |
| `rules/compressionBounds.ts` 的 4 个规则对象 | **未声明** `languages` | ✅ 有影响——未声明 ⇒ 不过滤 ⇒ **CMP-\* 目前在所有语言上运行** |
| `entries/governance.ts:259/271/283/295` | `ALL_LANGUAGES` | ❌ 仅元数据（`--list-rules`/文档/校验脚本） |

**动作**：
1. 在 `compressionBounds.ts` 顶部加 `const CMP_LANGUAGES = [LANGUAGE_TYPESCRIPT, LANGUAGE_JAVASCRIPT];`（两常量就地定义），并给 4 个规则对象各加 `languages: CMP_LANGUAGES,`。
2. `entries/governance.ts` 4 处 `ALL_LANGUAGES` 改为 `[LANGUAGE_TYPESCRIPT, 'javascript']`，保持元数据与运行时一致。

**依据约束 B**：目前 4 条规则的夹具**全部是 TS**，Python/GDScript/Rust 仅有惯用写法负样本（已证 0 命中），因此声明范围应等于已证范围。跨语言探针实测：`filesScanned=4, CMP findings=3`，3 条全在 TS——**没有任何一条规则在非 TS 语言上有正样本**。

**扩展路径（不在本轮）**：若将来要覆盖 Rust/Python，需先补足各语言的正样本夹具（如 Rust `let v = (a & mask) | (b << 2) ^ c;`），并逐语言验证后再扩声明。

### 2.8 步骤 A7：摘除错误的 `requiresRuntime`（修 P1-2，逻辑上属阶段 C，因同文件故并入 A 的提交）

`compressionBounds.ts:222-226`（`CMP-CAL-001`）：

```ts
                        evidence: {
                            confidence: 0.85,
                            requiresRuntime: false,
                        },
```

`requiresRuntime` 改为 `false`（或整字段省略）；同时移除 `:16` 的 `NEED_RUNTIME_EVIDENCE` import（该文件将不再使用它）。**理由**：回调嵌套深度是纯语法事实，运行时执行无法为其提供任何证据。

---

## 3. 阶段 B —— 验证 harness 重写（修 P0-2）

### 3.1 步骤 B1：新增负样本语料（**必须有**，这是 G2 的成立前提）

在 `scripts/validate-compression-bounds.js` 增加 `NEGATIVE_FIXTURES`，与既有 `COMPRESSION_FIXTURES` 并列。每条都是本次实测到的真误报形态或其最小化：

| 夹具 | 内容要点 | 期望命中 |
| :--- | :--- | :--- |
| `neg/jsdoc_semicolon.ts` | JSDoc 续行含 `;` 与两个"类语句"片段（复现 `security.ts:5`） | 0 |
| `neg/jsdoc_paths.ts` | `/** ... (if/for/while/match/switch/case/?/&&/\|\|). Default 0. */`（复现 `multilang.ts:111`） | 0 |
| `neg/regex_hash.ts` | `const COMMENT_LINE_RE = /^\s*(?:\/\/\|\/\*\|\*\|#)/;`（复现 `diffClassifier.ts:59`） | 0 |
| `neg/regex_class.ts` | `const CODE_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*(?:[-+*/%]?=\|\+\+\|--)/;`（复现 `simplify.ts:48`） | 0 |
| `neg/regex_import.ts` | `/^from[ \t]+(\.+\|...)[ \t]+import[ \t]+([^\n#]*)/.exec(`（复现 `dependencyGraph.ts:130`） | 0 |
| `neg/union_type.ts` | `export type Mode = 'a' \| 'b' \| 'c' \| 'd' \| 'e' \| 'f' \| 'g' \| 'h';` | 0 |
| `neg/intersection_type.ts` | `export type All = A & B & C & D & E & F & G & H & I;` | 0 |
| `neg/url_string.ts` | `const url = 'https://example.com/a/b/c'; const alt = 'http://x/y/z/w';` | 0 |
| `neg/division.ts` | `const r = total / count / scale / factor / base / unit;` | 0 |
| `neg/arrow_block.ts` | `const f = () => { a(); b(); };`（块体应被 `{}` 折叠保护） | 0 |
| `neg/guard_chain.ts` | `if (!a && !b && !c && !d && !e && !f) {` | **0** 或 1，见 §9-1 决策 |
| `neg/usage_text.ts` | `ts` 内多行模板：`--concurrency <n>  Max files in parallel (single-process; default: cpus)`（复现 `index.ts:242`） | 0 |

### 3.2 步骤 B2：真实源码回归语料（比合成夹具更有说服力）

直接对**本次 15 条误报的原始现场文件**做零命中断言：

```js
/** Production files that previously produced CMP false positives; they must stay clean. */
const FALSE_POSITIVE_SCENE_FILES = [
  'src/analyzers/security.ts',
  'src/analyzers/simplify.ts',
  'src/analyzers/comments.ts',
  'src/core/incrementalState.ts',
  'src/core/multilang.ts',
  'src/core/reporters.ts',
  'src/core/typescriptAdapter.ts',
  'src/core/dependencyGraph.ts',
  'src/core/router/diffClassifier.ts',
  'src/core/governance/rules/exceptionSafety.ts',
  'src/daemon/server.ts',
  'src/index.ts',
];
```

逐文件调用 `GovernanceAnalyzer`（沿用脚本既有的 `[3/3]` 直调方式）并断言每文件 `CMP-*` 命中 = 0，同时打印命中原文以便人工复核。

### 3.3 步骤 B3：真误报率公式（替换错误的 `cmpHitsInGov / totalGovLines`）

```js
const cmpTotal = issues.filter((i) => i.rule.startsWith('CMP-')).length;
const cmpOnNegative = issues.filter(
  (i) => negativeFiles.has(i.location.file.replace(/\\/g, '/')) && i.rule.startsWith('CMP-'),
).length;

// Guard first: without this, deleting every rule makes 0/0 pass silently.
assert.ok(cmpTotal >= EXPECTED_MIN_CMP_HITS, `positive fixtures must still fire (got ${cmpTotal})`);
const falsePositiveRate = cmpOnNegative / cmpTotal;
assert.ok(
  falsePositiveRate <= 0.05,
  `CMP false-positive rate ${(falsePositiveRate * 100).toFixed(2)}% must be <= 5%`,
);
```

关键差异：**分母是命中总数**（不是行数）；**先断言正样本仍有命中**，否则"把规则删空"会让该节恒真——这正是现版缺陷的根因。

### 3.4 步骤 B4：断言全部改为**精确等值**（补上界）

| 现版（只有下界，过报不可见） | 改为 |
| :--- | :--- |
| `assert.ok(expIssues.length >= 2)` | `assert.strictEqual(expIssues.length, 2)` |
| `assert.ok(linIssues.length >= 2)` | `assert.strictEqual(linIssues.length, 3)`（按新夹具重算后固定） |
| `assert.ok(calIssues.length >= 1)` | `assert.strictEqual(calIssues.length, 1)` |
| `assert.ok(denIssues.length >= 1)` | `assert.strictEqual(denIssues.length, 1)` |

`CMP-CAL-001` 在 `callbackDepth >= 3` 时**逐行**产出（`:213-228`），因此新夹具必须构造"恰好触达深度 3 一次"的形态，并把这一个数字锁死；再加一个"深度 4"的夹具断言 `=== 2`，把"每层一条"的行为显式固化下来（防止未来静默改变输出条数）。

### 3.5 步骤 B5：文件头声明与实现对齐

现文件头声明三项能力。改完后必须重新表述，且每条都能在代码里指出对应断言：

```
 * Responsibilities: Assert (1) every positive fixture is detected with an EXACT expected
 *     count, (2) the false-positive rate, computed over all CMP emissions with negative
 *     fixtures in the numerator, stays <= 5%, and (3) the 12 production files that once
 *     produced CMP false positives stay at zero emissions.
```

---

## 4. 阶段 C —— uncertainty 语义与刷新（修 P1-1 / P1-2 / P2-1 / P2-2）

### 4.1 步骤 C1：提取共享纯函数

新增 `src/core/uncertainty.ts`，把 `src/core/analyzer.ts:2545+` 的私有 `summarizeUncertainty` 原样迁入并导出（`analyzer.ts` 与 `api.ts` 同时 import）。六字段头注释按项目规范补全。

### 4.2 步骤 C2：`recomputeSummary` 补算（`src/api.ts:954-959`）

```ts
/**
 * Refresh the summary fields that depend on the final issue list.
 *
 * Post-scan passes (dependency-graph / literal-clusters / error-flow) append findings AFTER
 * Scanner.scan() already built the summary, so every derived aggregate must be recomputed
 * here — including `uncertainty`, which summarizes the same issue list.
 */
function recomputeSummary(report: ScanReport): void {
    const by = { info: 0, warning: 0, error: 0 };
    for (const i of report.issues) by[i.severity]++;
    report.summary.bySeverity = by;
    report.summary.issuesTotal = report.issues.length;
    report.summary.uncertainty = summarizeUncertainty(report.issues);
}
```

### 4.3 步骤 C3：让不变量**可失败**（这是本阶段的核心）

现版缺陷之所以潜伏，是因为没有任何夹具能让 post-scan 通道产出 issue。必须构造：

| 通道 | 触发夹具 |
| :--- | :--- |
| `dependency-graph` | 两个互相 `import` 的 TS 文件（`a.ts` → `b.ts` → `a.ts`），config 声明 `'dependency-graph': { enabled: true }` |
| `literal-clusters` | `constants: { enabled: true, options: { crossFileLiteralClusters: true } }` + 两个文件共享同一字面量 |
| `error-flow` | `hygiene: { enabled: true, options: { errorPropagation: true } }` + 跨函数重复 error code 字面量 |

在这三类夹具上断言：

```js
assert.ok(summary.postScanPasses.includes('dependency-graph'));
assert.strictEqual(
  issues.filter((i) => i.evidence && i.evidence.requiresRuntime === true).length,
  summary.uncertainty.requiresRuntimeCount,
  'uncertainty must be recomputed after post-scan issue appends',
);
```

**验收判据**：把 `recomputeSummary` 里的那一行 `uncertainty` 注释掉，此断言**必须变红**。

### 4.4 步骤 C4：`averageConfidence` 语义修正

```ts
/** Uncertainty metrics; `averageConfidence` is omitted when no finding carries evidence. */
export interface UncertaintySummary {
    requiresRuntimeCount: number;
    averageConfidence?: number;
}

export function summarizeUncertainty(issues: Issue[]): UncertaintySummary {
    let requiresRuntimeCount = 0;
    let confidenceSum = 0;
    let evidenceCount = 0;
    for (const issue of issues) {
        if (!issue.evidence) continue;
        evidenceCount++;
        confidenceSum += issue.evidence.confidence;
        if (issue.evidence.requiresRuntime === true) requiresRuntimeCount++;
    }
    const summary: UncertaintySummary = { requiresRuntimeCount };
    if (evidenceCount > 0) {
        summary.averageConfidence = Number((confidenceSum / evidenceCount).toFixed(2));
    }
    return summary;
}
```

同步：`src/core/types.ts` 的 `ScanSummary.uncertainty` 类型改为引用 `UncertaintySummary`；`report.schema.json` 的 `uncertainty` 对象补 `"required": ["requiresRuntimeCount"]`、`"additionalProperties": false`，描述改为"`averageConfidence` 仅统计携带 evidence 的发现；无 evidence 时省略"。

### 4.5 步骤 C5：摘除 `CMT-CON-001` 的 `requiresRuntime`（`src/analyzers/comments.ts:554-558`）

```ts
                                                 {
                                                     confidence: 0.6,
                                                 },
```

同时把 `IssueEvidence.runtimeEvidenceReason` 的 JSDoc 改为：

```ts
    /**
     * Rationale token explaining why runtime evidence is required. Only set this when the
     * conclusion can actually be confirmed or refuted by executing the code (e.g. an in-loop
     * lookup whose cost depends on the data); purely textual or syntactic facts must not
     * claim it, or `summary.uncertainty.requiresRuntimeCount` stops meaning anything.
     */
    runtimeEvidenceReason?: string;
```

**字段改名建议（待决，见 §9-2）**：`evidence` 是本次新增字段、尚未发布，改名 `runtimeEvidenceReason` → `runtimeEvidenceMarker` 无兼容性代价；若认为不必，则保留名字即可。

---

## 5. 阶段 D —— 一致性收尾

| 步骤 | 内容 |
| :--- | :--- |
| D1 | `entries/governance.ts` 顶部加 `/** Rule-id family prefix for the CMP compression-bounds family. */ const RULE_FAMILY_CMP = 'CMP';`，替换 4 处内联 `'CMP'`（`:256/268/280/292`） |
| D2 | 修正 `entries/governance.ts:16` 的 `/** Rule-id family prefix for governance rules; every id starts with GOV-. */`（现该文件已同时产出 `CMP-*`），并同步文件头 `:10-11` 的分组描述 |
| D3 | `docs/04-analyzers-and-rules/01-builtin-rules.md` 第 17 节补两句：① CMP-\* 随 `governance` 分析器启用，而该分析器位于 `SPECIALIZED_ANALYZERS`、**默认关闭**（`src/core/config.ts:82-83` + `:308`），与第 16 节语言包的表述口径一致；② 当前**仅对 TS/JS 生效**，其它语言需先补夹具再扩声明 |
| D4 | 同节补"已知漏报"一行：纯 `&`/`|` 位运算行（无 `<<`/`>>`/`^`/`~`）不再报告 |
| D5 | `package.json`：把 `validate-compression` 从 `test` 链**末尾**前移到 `validate-governance` 之后（同类域相邻），避免该套件失败要等前 31 套跑完才暴露。**仅做前移，不重构整条链** |

---

## 6. 提交切分与依赖顺序

```
分支：fix/governance-cmp-masking
提交前缀遵循 AGENTS.md：<type>(<scope>): 简述（正文中文引需求ID）
本机 git 全局 commit.gpgsign=true 且密钥环不可用 ⇒ 需 --no-gpg-sign
```

| 序 | 提交 | 内容 | 前置 | 依赖理由 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `feat(governance): 新增代码视图构建器，掩码注释/字符串/正则` | 新增 `codeView.ts`、`RuleEvaluationContext.masked`、分析器注入 | — | 纯新增，不改任何规则行为，可独立验证 `npm run build` 全绿且**所有既有输出逐字节不变** |
| 2 | `fix(governance): CMP-* 改消费掩码视图，消除注释与正则误报` | 删 3 个 strip 函数、四规则改取 `ctx.masked`、收紧 `hasBitwise`、语言收窄、摘 `requiresRuntime` | 1 | 必须与 1 同批上线；单独提交 2 会因缺少 `masked` 而编译失败 |
| 3 | `test(governance): 重写压缩下界验证为真误报率并补负样本语料` | `validate-compression-bounds.js` 重写 | 2 | 断言基于修好后的实际条数 |
| 4 | `fix(core): uncertainty 摘要纳入 post-scan 重算并修正语义` | `uncertainty.ts`、`api.ts`、`comments.ts`、`schema`、`types.ts` | — | 与 1-3 无耦合，可并行；但建议排在 3 之后，让 harness 先能失败 |
| 5 | `docs(governance): 补齐 CMP-* 启用口径、语言范围与已知漏报` | 文档 + `entries` 常量/注释 + `package.json` 前移 | 2,4 | 文档需反映最终实现 |

---

## 7. 门禁与验收矩阵

### 7.1 每阶段必跑

| 命令 | 期望 | 说明 |
| :--- | :--- | :--- |
| `npm run build` | exit 0 | 提交 1/2 的编译闸门 |
| `npm run format:check` | exit 0 | Prettier |
| `npm run lint` | exit 0 | 注意 `max-len`：本项目 ESLint 限 100 列（本次曾因此失败） |
| `npm run gate:comments` | exit 0 | 六字段头契约；**新增的 `codeView.ts` / `uncertainty.ts` 必须带齐 6 个字段**，不可漏 `Exit Semantics & Design Rationale` |
| `npm run gate:self` | exit 0 | 自扫描棘轮（error 级），171 文件 |

### 7.2 变更相关（必须全绿）

| 命令 | 期望 | 关键点 |
| :--- | :--- | :--- |
| `npm run validate-compression` | exit 0 **且具备可失败性** | 用 §4.3 的"注释掉一行必须变红"手法验证 harness 本身有效 |
| `npm run validate-governance` | exit 0 | ⚠️ **高风险**：该套件断言 `Category 'maintainability' detected (findings: 5)`，而 CMP-\* 正属于 `maintainability` 类别。语言收窄（A6）与 `hasBitwise` 收紧（A5）**可能改变该计数**，需复跑并同步更新断言 |
| `npm run validate-rules-registry` | exit 0 | 现报 110 条规则、docs 覆盖 110/110；收窄语言不改条数，但**若改了规则 id 或摘要需同步文档** |
| `npm run validate-rule-aliases` | exit 0 | 别名表与 legacy 集合一对一 |
| `npm run validate-docs` | exit 0 | — |
| `npm run validate-language-matrix` | exit 0 | 已核对：该套件只断言"每种语言能被适配器扫描 / 语言无关 hygiene 规则命中 / 该语言现代化包按声明命中 / 未知扩展名 fail-closed"，**不校验 governance 的语言声明**，故收窄 CMP 语言不影响它 |
| `npm run validate-dependency-graph` 等 post-scan 套件 | exit 0 | 提交 4 触及 `recomputeSummary`，需复跑全部 post-scan 相关套件 |
| `npm run test-codec` | exit 0 | 报告序列化回归 |

### 7.3 全局闸门（合入前）

| 命令 | 期望 |
| :--- | :--- |
| `npm run gate` | exit 0（build + format:check + lint + gate:comments + gate:self + 32 段 test 全绿） |
| `npm run test` | exit 0 |

### 7.4 专项验收

| 项 | 命令 / 方式 | 判据 |
| :--- | :--- | :--- |
| G1 收敛 | governance 单开扫描本项目 `src/**/*.ts` | `CMP-*` 命中 **16 → 0**（1 条待决见 §9-1） |
| G2 可失败 | 临时把任一 CMP 规则 `checkFile` 改为 `return null` | `validate-compression` **必须 exit 1** |
| G3 自洽 | §4.3 三类 post-scan 夹具 | `uncertainty` 与 `issues` 不变量成立；注释掉重算行必须变红 |
| 约束 A | 四个语言包套件 + 全部既有套件 | 全部 exit 0，且报告 JSON 与改前**逐字节一致**（除 CMP-\*/uncertainty 相关字段） |

---

## 8. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
| :--- | :--- | :--- | :--- |
| `validate-governance` 的 maintainability 计数断言被打破 | **高** | 门禁红，非产品缺陷 | 提交 2 后立即复跑；若计数变化，是"预期变更"，同步更新断言并在提交正文说明原因 |
| `RuleEvaluationContext.masked` 设为必填导致**自定义分析器/插件**编译失败 | 低 | 破坏外部插件 | 已确认构造点仅 2 处（均在 `analyzers/governance.ts`）；若有外部插件实现 governance 规则，需在 CHANGELOG 标注 SPI 变更。**开工前用 `grep -rn "RuleEvaluationContext" src/ scripts/` 复核一次** |
| 掩码导致性能回退 | 低 | 扫描变慢 | 分析器已按文件新建实例，掩码为每文件一次 O(行数) 扫描，与既有 `content.split()` 同阶；用 `npm run benchmark` 与 MIXED 基线对比，门槛取现有协议的 8% |
| 语言收窄使某语言使用者"规则消失" | 中 | 行为变更 | 属**修错**而非回归：现状是声明了却无夹具与验证。须在 doc 第 17 节与 CHANGELOG 明确写出 |
| 与并发进程产生冲突（审查期间已发生一次） | 中 | 重复劳动/覆盖 | 开工前复核 §9 指纹；用独立分支 `fix/governance-cmp-masking` |
| 误报修复过度、真阳性被削弱 | 中 | 漏报 | §3.1 的正样本夹具 + §3.4 的精确等值断言即为护栏；`EXPECTED_MIN_CMP_HITS` 防止规则被削空 |

**回滚**：5 个提交彼此可独立 `git revert`（提交 2 依赖 1，需成对回滚）。回滚后 `npm run gate` 必须恢复 exit 0。

---

## 9. 开工前需用户决策的开放项

**9-1 `CMP-EXP-001` 对 6 项 `&&` 守卫链的判定**
`src/core/oxcAdapter.ts:1039`：`if (!isLiteral && !fnLike && !isClassDefining && !isBinding && !isScope && !topLevel) {`

| 选项 | 做法 | 后果 |
| :--- | :--- | :--- |
| A（推荐） | 保留阈值 `>= 5`，把该条判为**真阳性**并纳入 harness 期望计数 | G1 目标变为"16 → 1"，与规则声明的契约一致（长逻辑链确实超出可读下界） |
| B | 阈值提到 `>= 7` | 该条不再命中，G1 达成"16 → 0"；但会漏报 5-6 项的真实长链 |
| C | 增加"括号感知"豁免（仅当链被括号分段时放行） | 语料上更准，但实现复杂度上升，且需更多夹具 |

**请指定 A/B/C。** 未指定前按 A 执行（改门槛最小、可立即验证）。

**9-2 `runtimeEvidenceReason` 是否改名**
改为 `runtimeEvidenceMarker`（名字与"恒为同一哨兵常量"的事实相符）？因 `evidence` 为本次新增、尚未发布，无兼容性代价。**请指定改/不改。**

**9-3 `entries/governance.ts` 的语言独立性**
该文件现由 `GOV-*` 与 `CMP-*` 两个族共用。本次仅在 `CMP-*` 条目的 `languages` 上收窄。若后续要引入更多族，建议评估是否按族拆分文件（不在本轮）。

---

## 10. 开工前基线复核（约束 C）

```powershell
# 1) 工作树是否仍为审查时的那一版
git -C C:\CODE_game-development\vscode-extensions status --porcelain=v1
# 期望：13 个 M（前缀 auto-refactor/）+ 2 个 ??

# 2) 关键文件指纹（与审查报告 §9 表格逐行比对）
#    compressionBounds.ts                期望 5f1637f7b7f2
#    scripts/validate-compression-bounds.js  期望 e66306469d3c
#    src/core/types.ts                   期望 2f00f8639f99
```

**不一致即说明工作树已再次变动**，此时应重跑复现探针（governance 单开扫描 `src`，统计 `CMP-*` 命中数与逐条 `file:line`）后再决定计划是否需要调整——本次审查期间已出现过 `gate:comments`/`lint` 由红转绿的并发修复，不可假设缺陷仍在。

---

## 附：阶段 A 的两个验证探针（可直接复用）

```js
// probe-fp.js —— 统计 CMP-* 在生产源码上的命中并逐条打印原文，用于 G1 验收
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = '<auto-refactor 绝对路径>';
const { scan } = require(path.join(ROOT, 'dist/api'));

const cfg = path.join(os.tmpdir(), 'probe-fp-cfg.json');
fs.writeFileSync(cfg, JSON.stringify({
  include: ['src/**/*.ts'],
  analyzers: { governance: { enabled: true }, constants: { enabled: false }, complexity: { enabled: false } },
}, null, 2));

(async () => {
  const r = await scan({ root: ROOT, configFile: cfg, cache: false, logLevel: 'error' });
  const cmp = r.issues.filter((i) => i.rule.startsWith('CMP-'));
  console.log(`CMP findings = ${cmp.length}`);
  for (const i of cmp) {
    const lines = fs.readFileSync(path.join(ROOT, i.location.file), 'utf8').split(/\r?\n/);
    console.log(`${i.rule} ${i.location.file}:${i.location.start.line} :: ${i.message}`);
    console.log(`    SRC ${lines[i.location.start.line - 1]}`);
  }
})();
```

```js
// probe-postscan.js —— 验证 uncertainty 在 post-scan 追加后仍自洽（G3 验收）
// config 同时开启 dependency-graph + constants.crossFileLiteralClusters + hygiene.errorPropagation，
// 夹具需含互相 import 的两个文件，然后断言：
//   issues.filter(i => i.evidence?.requiresRuntime === true).length
//     === summary.uncertainty.requiresRuntimeCount
// 以及 summary.postScanPasses 确实包含 'dependency-graph'（证明通道真的跑过而非空过）。
```
