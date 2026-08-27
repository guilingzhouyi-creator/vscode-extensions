# 统一性能基准脚本规格（scripts/bench-baselines.js）

> 作者：架构师（高见远）｜日期：2026-08-13｜状态：规格定稿（只设计不实现）
> 目标：一条命令跑完「等价门 → 标准 benchmark → 大文件对比 → profile」，并做历史基线持久化，供每次性能迭代使用。

---

## 0. 设计原则与关系说明

| 现有脚本 | 本脚本与它的关系 |
|---|---|
| `scripts/validate-equivalence.js`（9 场景等价门，末尾 `process.exit()`） | **用 child_process spawnSync 调用**，不 `require()`（会因 `process.exit()` 杀死父进程）。不改它。 |
| `scripts/benchmark.js`（300 文件 workers=1，含语料生成与 NODE_PATH 技巧） | 复制最小语料生成逻辑（3 模板 + 配置）进本脚本，参数化输出目录。不改它。 |
| `scripts/baselines/*`（golden 基线） | 只读，不写（除非 `--update` 是给 bench-history 用的，与 validate 基线无关）。 |

**硬约束**：不改 `src/`、`scripts/baselines/*`、`scripts/benchmark.js`、`scripts/validate-equivalence.js`。本脚本是独立新增文件，逻辑可 import 或复制最小片段。

---

## 1. CLI 参数契约

```
node scripts/bench-baselines.js [选项]

  --files=<n>            阶段2 标准语料文件数（默认 300）
  --iterations=<n>       阶段2/3 每 dist 的重复次数，取中位（默认 5）
  --workers=<n>          阶段2/3 scan 的 worker 数（默认 1；基准口径固定 1）
  --vs-mixed             对比 MIXED dist（阶段2 与阶段3 都生效）
  --mixed-dist=<path>    MIXED dist 路径（默认 C:/tmp/ar-mixed-dist）
  --skip-validate        跳过阶段1 等价门（CI 中已单独跑过 validate 时用；慎用）
  --update               覆盖 bench-history.json 中最近一条（默认是追加）
  --json                 输出机器可读 JSON（见 §5.2）

可选扩展（不改默认行为，便于深挖）：
  --big-files=<n>        阶段3 大文件数（默认 12）
  --big-lines=<n>        阶段3 每文件目标行数（默认 ~2600）
  --profile-iters=<n>    阶段4 每计时项次数（默认 10）
  --parser=<ts|oxc>      阶段2/3 的解析器（默认 typescript；阶段4 同时测两者）
```

解析用现有 `arg(name, dflt)` 模式（`--name=value`），布尔参数用 `process.argv.includes('--x')`。

---

## 2. 脚本结构（函数签名）

```js
#!/usr/bin/env node
// bench-baselines.js — 一键统一基准（等价门 + 标准 + 大文件 + profile + 历史）

// ---- 配置与解析 ----
function parseArgs(argv) → { files, iterations, workers, vsMixed, mixedDist,
                             skipValidate, update, json, bigFiles, bigLines,
                             profileIters, parser }

// ---- 共享工具 ----
function setupNodePath()          // process.env.NODE_PATH = ROOT/node_modules; require('module').Module._initPaths()
function cleanStaleCorpora()      // rm -rf: scripts/.corpus scripts/.bench-corpus scripts/.rust-corpus C:/tmp/ar-bench-big（带重试）
function median(arr), mean(arr)
function sleep(ms)
function writeFileAtomic(file, data)  // 写 .tmp 后 rename，避免 Windows 半写损坏
function buildConfig(root, workers)   // 复用 benchmark.js 的 config 形状（thresholds/analyzers/customAnalyzers）

// ---- 阶段1：等价门 ----
async function stage1Validate(opts) → { ok: boolean, passed: number, total: number }
// spawnSync(process.execPath, ['scripts/validate-equivalence.js'], { cwd: ROOT, stdio: 'inherit' })
// ok = (status === 0)；失败时本脚本中止（见 §4）

// ---- 阶段2：标准 benchmark（300 文件 workers=1）----
function buildCorpus300(dir, files, workers) → configPath   // 复制 benchmark.js 3 模板，输出到 C:/tmp/ar-bench-standard（先清理）
async function timeScan(api, root, configPath, opts) → { medianMs, files, issues }
async function stage2Standard(opts) → { new300, mixed300|null, speedup|null }

// ---- 阶段3：大文件对比（12 × ~2600 行）----
function buildBigCorpus(dir, bigFiles, bigLines, workers) → configPath  // 输出到 C:/tmp/ar-bench-big
async function stage3Big(opts) → { newBig, mixedBig|null, speedup|null }

// ---- 阶段4：单文件 profile（200 函数，分阶段计时）----
function synthesizeProfileFile(functions=200) → content  // ~2600-3000 行，与历史口径一致
function makeProfileEntries(content, config, adapter, root) → StreamingEntry[]
async function stage4Profile(opts) → { createSourceFileMs, parseTsMs, mapTsMs,
                                       parseOxcMs|null, mapOxcMs|null,
                                       runStreamingMs, materializationRatio }

// ---- 历史持久化 ----
function loadHistory(file) → HistoryEntry[]
function saveHistory(file, entries)
function recordRun(entries, metrics, opts) → HistoryEntry[]  // 默认追加；--update 覆盖最近一条
function fmtDelta(cur, ref) → "-12%" 风格

// ---- 输出 ----
function printHuman(metrics, history, opts)
function printJson(metrics, history, opts)

async function main() { /* 编排四阶段，失败处理见 §4 */ }
main().catch(e => { console.error(e); process.exit(1); });
```

---

## 3. 四阶段规格

### 3.1 阶段 1：等价门（validate）

- **执行**：`spawnSync(process.execPath, [path.join(__dirname,'validate-equivalence.js')], { cwd: ROOT, stdio: 'inherit' })`。
- **9 场景**：samples-default / samples-custom / corpus-inproc / corpus-workers / rust-inproc / rust-workers / samples-default-oxc / corpus-inproc-oxc / corpus-workers-oxc。
- **成功**：`status === 0` → `console.log('[bench-baselines] stage1 validate ....... PASS (9/9)')`，继续阶段 2。
- **失败**：`console.error('[bench-baselines] 输出已变，性能无效 —— validate 未全 PASS，基准中止')`；`process.exit(1)`。
- **`--skip-validate`**：跳过本阶段，打印 `SKIP`，不中止。
- **注意**：validate-equivalence.js 自身会写 `.corpus` / `.rust-corpus`；本脚本在阶段 1 前先 `cleanStaleCorpora()` 清理这三个目录（`.corpus`、`.bench-corpus`、`.rust-corpus`）与 `C:/tmp/ar-bench-big`，避免上次残留与 Windows 文件锁。

### 3.2 阶段 2：标准 benchmark（300 文件 workers=1）

- **语料**：复制 `benchmark.js` 的 3 个 `TEMPLATES` 与 `big` 模板生成逻辑，输出到 `C:/tmp/ar-bench-standard`（**先 `rmSync` 清理再生成**）；配置 `buildConfig(root, workers)`（workers 取 CLI，默认 1；logLevel 用 `'silent'` 的场景级覆盖，避免污染输出）。
- **计时**：
  ```js
  const newApi = require(path.join(ROOT, 'dist', 'api'));
  const neu = await timeScan(newApi, CORPUS, cfg, { iterations: ITERS, workers });
  ```
  `timeScan` 每次迭代 `api.scan({ root, configFile, workers, format:'json', logLevel:'silent', parser })`，取 `ITERS` 次中位；记录 `summary.filesScanned / issuesTotal`。
- **`--vs-mixed`**：`setupNodePath()` 后 `require(path.join(MIXED_DIST, 'api'))`，同一语料再跑一遍（scan 只读，语料不被改动）。输出 `mixed300` 与 `speedup = mixed300/new300`。
- **失败处理**：NEW 计时失败（dist 缺失/scan 抛错）→ 打印错误并 `exit(1)`（核心阶段）；MIXED 缺失 → `console.warn('[bench-baselines] MIXED dist 不存在，跳过对比')`，`mixed300 = null`，**不退出**。

### 3.3 阶段 3：大文件对比（12 × ~2600 行）

- **语料**：`buildBigCorpus(dir, 12, 2600, workers)` 生成 12 个文件，每个 ~200 函数（每函数 ~13 行 → ~2600 行），函数名/常量按文件 seed 变化，避免文件雷同。输出到 `C:/tmp/ar-bench-big`（**生成前清理**；语料可保留供人工复测）。
- **计时**：NEW 与（可选）MIXED 各 `ITERS`（默认 5）次中位；输出 `newBig / mixedBig / speedup`。
- **NODE_PATH 处理**（关键，复用 benchmark.js 的做法）：
  ```js
  process.env.NODE_PATH = path.join(ROOT, 'node_modules');
  require('module').Module._initPaths();
  ```
  必须在 `require(MIXED_DIST/api)` **之前**执行（MIXED 内部 `require('typescript')` 依赖仓库 node_modules）。
- **合理性告警**：若 `newBig` 与历史首条 `newBig` 偏差 > ±30%，打印 `WARN: 与历史基线偏差过大，注意机器负载/环境变化`（只提示不中断）。

### 3.4 阶段 4：单文件 profile（200 函数分阶段计时）

- **语料**：`synthesizeProfileFile(200)` 生成单文件内容（与历史口径一致：~200 函数 / ~2600-3000 行 / ~99KB）。
- **计时项**（各 `profileIters` 次，取均值）：
  1. `createSourceFile`：`require('typescript').createSourceFile(name, content, ScriptTarget.Latest, /*setParentNodes*/ false)` —— 纯解析。
  2. `TypeScriptAdapter.parse(content, file)`：`new (require('../dist/core/typescriptAdapter').TypeScriptAdapter)()` 直接实例化（适配器无状态，可复用）。`mapTs = parseTs − createSourceFile`（物化归一成本）。
  3. `OxcAdapter.parse`（若 `oxc-parser` 可解析）：`new (require('../dist/core/oxcAdapter').OxcAdapter)()`；`parseOxc = oxc-parser.parseSync` 计时、`mapOxc = OxcAdapter.parse − parseOxc`。加载失败 → `null` + `WARN`（默认 TS 路径不触碰 oxc native binding，此处显式探测）。
  4. `runStreaming`：`require('../dist/core/traverse').runStreaming(adapter, root, entries)`，`entries` 由 `makeProfileEntries` 构造——实例化 `dist/analyzers/{constants,largeFile,complexity}` 三个内置 analyzer + `FileMetricCollector`（dist/core/traverse），`ctx` 最小字段为 `{ filePath, content, config, options, root, adapter }`（options = thresholds 合并结果；lineStats 可由 `dist/utils/ast` 的 `countLineStats` 提供，与引擎口径一致）。**复用同一份 `ast` 与 `entries` 对象**，避免把构造成本计入。
- **输出**：
  ```
  createSourceFile 12.4ms | parse+map(TS) 35.5ms | mapNode 23.1ms | parseSync(oxc) 4.1ms | mapOxc 31.4ms | runStreaming 9.8ms | 物化占比 65%
  ```
  `materializationRatio = mapTs / parseTs`（TS 口径；oxc 存在时另算 `mapOxc / (parseOxc + mapOxc)` 供参考）。
- **失败处理**：任意计时项抛错 → 该项记 `null` + `WARN`，不中断其他项；若 `createSourceFile` 或 `parseTs` 全失败 → 阶段失败 `exit(1)`。

---

## 4. 失败处理汇总

| 场景 | 行为 |
|---|---|
| 阶段1 validate 未全 PASS（非 `--skip-validate`） | 打印「输出已变，性能无效」，`exit(1)` |
| 阶段2 NEW 计时失败 | 打印错误，`exit(1)` |
| MIXED dist 缺失 | `WARN` + 对应指标置 `null`，继续 |
| 阶段3 语料生成遇 Windows 文件锁（EBUSY/EPERM） | 重试 3 次、间隔 300ms；仍失败 `exit(1)` |
| 阶段3/4 可选指标失败（oxc 不可用等） | `WARN` + `null`，继续 |
| bench-history.json 不存在 | 首次运行自动创建（含 `schemaVersion: 1`） |
| bench-history.json 损坏 | `WARN` + 备份为 `.bak-<ts>`，以空历史继续 |

所有阶段**串行**执行（不并行），避免 CPU 争用污染计时。

---

## 5. 输出格式

### 5.1 人类可读（默认）

```text
[bench-baselines] stage1 validate ....... PASS (9/9)
[bench-baselines] stage2 300 files ...... NEW median 109.2ms (files=300 issues=42)
[bench-baselines]                                        MIXED median 94.5ms  speedup 1.16x
[bench-baselines] stage3 big(12x2600) .... NEW median 584.0ms  MIXED median 853.0ms  speedup 1.46x
[bench-baselines] stage4 profile(200fn) .. createSourceFile 12.4ms | parse+map 35.5ms | mapNode 23.1ms | parseSync(oxc) 4.1ms | runStreaming 9.8ms | 物化占比 65%
------------------------------------------------------------
metric             本次      上次       Δ(上次)    首次       Δ(首次)
new300            109.2     105.1       +3.9%    129.0      -15.4%
mixed300           94.5      93.0       +1.6%     93.0       +1.6%
newBig            584.0     601.0       -2.8%     853.0      -31.5%
mixedBig          853.0     849.0       +0.5%     853.0       0.0%
createSourceFile   12.4      12.1       +2.5%     14.9       -16.8%
mapTs              23.1      22.6       +2.2%     23.1        0.0%
parseOxc            4.1       4.9      -16.3%      4.9       -16.3%
runStreaming        9.8       9.6       +2.1%      9.8        0.0%
------------------------------------------------------------
[bench-baselines] history: scripts/bench-history.json (N entries)
```

只使用 `console.log` / `console.error`（不依赖 TTY），调用方可安全重定向到文件。

### 5.2 机器可读（`--json`）

```json
{
  "ok": true,
  "date": "2026-08-13T10:30:00.000Z",
  "stages": {
    "validate": { "passed": 9, "total": 9 },
    "standard": { "new300": 109.2, "mixed300": 94.5, "speedup": 1.16 },
    "big": { "newBig": 584.0, "mixedBig": 853.0, "speedup": 1.46 },
    "profile": {
      "createSourceFile": 12.4, "parseTs": 35.5, "mapTs": 23.1,
      "parseOxc": 4.1, "mapOxc": 31.4, "runStreaming": 9.8,
      "materializationRatio": 0.65
    }
  },
  "deltas": {
    "new300": { "vsLast": 0.039, "vsFirst": -0.154 },
    "newBig": { "vsLast": -0.028, "vsFirst": -0.315 }
  },
  "historyPath": "scripts/bench-history.json",
  "historyEntries": 5
}
```

---

## 6. 历史基线持久化（scripts/bench-history.json）

追加式数组，**原子写**（写 `.tmp` 后 rename）。每条：

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "date": "2026-08-13T10:30:00.000Z",
      "commit": "abc1234",
      "new300": 109.2,
      "mixed300": 94.5,
      "newBig": 584.0,
      "mixedBig": 853.0,
      "createSourceFile": 12.4,
      "parseTs": 35.5,
      "mapTs": 23.1,
      "parseOxc": 4.1,
      "mapOxc": 31.4,
      "runStreaming": 9.8,
      "materializationRatio": 0.65,
      "env": { "node": "v22.22.2", "os": "win32", "cpu": "12 logical" },
      "flags": { "files": 300, "iterations": 5, "workers": 1, "bigFiles": 12, "bigLines": 2600, "parser": "typescript" }
    }
  ]
}
```

- **默认**：追加一条新记录。每次运行都留痕，输出「本次 vs 上次 vs 首次」三列（`fmtDelta`：`(cur-ref)/ref` 百分号）。
- **`--update`**：**覆盖最近一条**（原地替换，历史长度不变）——用于同一口径重跑（如重编译后复测基线），避免噪音堆积。
- 对比基准：`上次` = entries[length-2]，`首次` = entries[0]。历史为空或仅 1 条时对应列显示 `-`。

---

## 7. 环境坑处理清单

| 坑 | 处理 |
|---|---|
| Windows 文件锁（语料被上次进程占用） | 生成前 `cleanStaleCorpora()`（rmSync recursive+force）；EBUSY/EPERM 重试 3 次 × 300ms |
| MIXED dist 无法解析 `typescript` | `setupNodePath()`（NODE_PATH + `Module._initPaths()`）在 `require(MIXED api)` **之前**调用 |
| `require('./validate-equivalence.js')` 会 `process.exit()` 杀死本脚本 | 一律用 `spawnSync` 子进程调用，绝不 require |
| 输出被 Bash 吞掉 | 本脚本只 `console.log`，由调用方重定向；不写文件日志 |
| 历史文件写一半损坏 | 原子写（.tmp + rename）+ 损坏时备份 `.bak-<ts>` |
| 阶段并行导致 CPU 争用污染计时 | 四阶段严格串行 |
| `.d.ts` / 大语料被 `respectGitignore` 误排 | 语料目录带 `auto-refactor.config.json` 且 `respectGitignore:false`（与 validate 的 corpus 配置一致） |

---

## 8. 验收标准（工程师实现后自测）

1. `node scripts/bench-baselines.js` 全流程跑通：stage1 9/9 PASS → stage2/3/4 出数 → 生成 `bench-history.json` 第 1 条。
2. `node scripts/bench-baselines.js --vs-mixed` 输出 MIXED 列与 speedup（与历史量级一致：300 文件 ~1.1-1.4x、大文件 ~1.4-1.5x）。
3. `node scripts/bench-baselines.js --skip-validate --json` 输出合法 JSON，`ok:true`。
4. 故意把 dist 改名 → 阶段 2 `exit(1)` 且报错可读；把 `C:/tmp/ar-mixed-dist/api.js` 改名 → `WARN` 且 `mixed300:null` 不退出。
5. `--update` 后 entries 长度不变且末条被替换；`--iterations=3` 与 `--files=150` 可正常缩放。
6. 现有 `npm run validate` / `npm run benchmark` 行为不变（本脚本为独立新增）。
