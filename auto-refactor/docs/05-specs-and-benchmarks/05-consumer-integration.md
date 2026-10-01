# 05. 外部工程接入与基线棘轮指南

> **所属层级**：L5 规范、三平面质量度量与性能基准 (`docs/05-specs-and-benchmarks/`)  
> **对应代码真源**：`src/core/reporting/reportFinalizer.ts`、`scripts/gate-self.js`、`scripts/validate-baseline-ratchet.js`、`scripts/validate-consumer-runner.js`

---

## 1. 存量工程无痛接入：基线棘轮机制 (Baseline Ratchet v1.2.0)

存量大型项目在首次引入 243 条规则时，往往存在数百至数千条历史存量警告。若直接开启全量阻断会导致 CI 瘫痪；若完全关闭规则又会导致新代码继续腐化。`auto-refactor` 通过 **单向收紧基线棘轮（Monotonic Downward Ratchet）** 完美解决该矛盾：

### 1.1 棘轮信用消耗语义 (`baseline.json` 1.2.0)

棘轮将 `baseline.json` 中的每一条历史记录视为**一张不可跨级透支的信用额度（Credit）**：

| 对比情形 | 门禁判定结果 | 判定依据 |
| :--- | :---: | :--- |
| 某「分析器\|规则\|文件」存量记录为 $N$ 次，本次扫描出现 $N+1$ 次 | **阻断 (`newBlocking`)** | 前 $N$ 次消耗历史信用，第 $N+1$ 次无信用可用，精确识别为本次提交新增违规 |
| 同一行已有 1 条违规，本次在同一行又新增 1 条同规则违规 | **阻断 (`newBlocking`)** | 1.2.0 基线按严重度直方图记录重数（Multiplicity），不再因行号相同而漏放 |
| 历史 `warning` 级发现因文件继续膨胀越过 `fileLinesFail` 升级为 `error` | **阻断 (`newBlocking`)** | 低严重度信用严禁抵扣高严重度违规 |
| 历史违规被修复，当前数量为 $N-1$ 次 | **通过 (PASS)** | 存量真实下降，可通过 `baselineRatchetDown: true` 自动收紧基线水位 |

---

## 2. 工作区兄弟项目联动接入范式

### 2.1 `workspace-timing/`（VS Code 扩展 L0~L5 六层门禁联动）

- 接入方式：通过 `workspace-timing/scripts/` 调用 `auto-refactor` 扫描 `src/**/*.ts`；
- 核心启用分析器：`secrets`（L0 密钥扫描）、`dependency-graph`（`cycles` 循环依赖与 `unused-export` 无用导出检测）、`architecture`（五层单向依赖守护 `UI -> Engine -> Storage -> Analytics -> Shared`）以及 `governance`。

### 2.2 `WebGames/`（Godot 4.7 GDScript 引擎接入）

- 接入方式：识别 `.gd` 与 `config/**/*.json`；
- 核心启用分析器：`gdscript-modern`、`gdscript-game`（强制循环内零瞬态堆分配 `GME-PRF-001`、对象池 `reset_state()` 契约与前端仅经 `apply_snapshot()` 渲染边界）。

---

## 3. 标准 CI 集成命令模板

```bash
# 1. 日常增量 PR 门禁：对比 baseline.json，仅当出现新增 error 时阻断 (Exit 1)
npx auto-refactor scan --config auto-refactor.config.json --baseline baseline.json --fail-on-issue

# 2. 导出 GitHub Code Scanning 标准 SARIF 2.1.0 报告
npx auto-refactor scan --format sarif --out sarif/auto-refactor.sarif

# 3. 存量历史债务清理后，单向收紧更新基线（严禁未经 --force-expand 扩大基线）
npx auto-refactor scan --update-baseline baseline.json --baseline-ratchet-down
```

---

## 4. 关联文档导航

- [01. 配置模式与多格式报告契约](./01-config-and-reports.md)
- [06. 多语言现代化规则包与常量单源治理](./06-modernization-program.md)
