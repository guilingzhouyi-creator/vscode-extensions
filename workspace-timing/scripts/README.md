# workspace-timing 脚本库与自动化审查系统

> 本目录是**本项目自己的**工程基础设施。设计参考了 WebGames 已验证的脚本库实践（注册表驱动、统一结果契约、外部工具优雅降级、元审查），但按本项目形态（VS Code 扩展 / Node>=20 / Windows 主开发环境）重新实现，**不依赖、不引用、不绑定 WebGames**。

## 0. 语言与构建（TypeScript + 自举安全）

- 脚本库源码为 **TypeScript**（`scripts/**/*.ts`，NodeNext + strict），经 `npm run scripts:build` 编译到 `scripts/dist/**/*.js`（ESM，由本目录 `package.json {"type":"module"}` 声明；根包扩展仍为 commonjs，互不影响）。`dist/` 不入库、不入扫描面。
- **自举安全设计**：`npm run review*` 一律先 `scripts:build` 再运行——审查工具的构建与业务 `tsc` 编译链**完全独立**（根 tsconfig 仅含 `src/`）。业务代码编译失败时，L0-COMPILE 照常给出阻断结论，而审查工具自身不受影响。
- **悬空防护**：注册表 `checker` 字段指向**源码路径**（如 `audit/hardcode.ts`），编排器执行 dist 镜像前先校验源文件存在——源已删除而注册表未清理（或增量构建残留旧产物）时，该检查器判 CONFIG_ERROR 阻断，杜绝"执行过期产物"与"宣称执行实际缺失的能力"。

## 1. 总体架构

```text
                 npm run review / CI / Agent
                            │
                  scripts/dist/review/run-review.js   ← 编排器 + Quality Gate
                            │
        ┌──────────┬────────┼──────────┬──────────────┐
        ▼          ▼        ▼          ▼              ▼
   build/       test/    audit/    benchmark/     tooling/
   L0 编译    L0 测试   L1/L2/L3/L4  L4 预算      L5 适配器
        ▲                                   │
        │                            稳定 CLI 契约
   scripts/common/*.ts（类型化原子能力库）      ▼
        ▲                            auto-refactor（外部项目）
        └── 悬空/孤儿由 audit/review-config + script-standard 双向把关
```

- **依赖方向**：checkers → common → （无）；common 绝不反向依赖 checkers；common 绝不引用 WebGames / auto-refactor。
- **auto-refactor 是外部审查能力提供者**，经 `tooling/refactor-adapter.mjs` 单点接入；其缺失/超时/版本漂移只降级不摧毁本系统（见 §6）。

## 2. 目录与职责

| 目录 | 职责 | 传染性约束 |
|---|---|---|
| `common/` | 原子能力：日志/路径/进程/结果契约/配置读取/扫描/参数 | 库模块，不注册为检查器；禁止 import 任何业务层与外部项目 |
| `config/` | 三类配置**严格分离**：`review-rules.json`（审查规则）/ `refactor-adapter.json`（外部工具适配）/ `auto-refactor.config.json`（外部工具原生格式）/ `test-budget-baseline.json`（基线） | 与插件运行时配置（package.json contributes）互不混写 |
| `build/` | L0 构建门禁 | 检查器，须注册 |
| `test/` | L0 测试门禁 | 检查器，须注册 |
| `audit/` | L1 代码质量 / L2 结构 / L3 治理与元审查 / L4 确定性性能模式 | 检查器，须注册 |
| `benchmark/` | L4 性能预算 | 检查器，须注册 |
| `tooling/` | 外部工具适配层 | 检查器，须注册；唯一允许触碰外部 CLI 契约的位置 |
| `review/` | 编排器与报告 | 非 checker，豁免注册 |

## 3. 脚本头契约（机器可检查）

每个 `.mjs` 文件头 20 行内必须包含以下标签（由 `audit/script-standard.mjs` 强制）：

```text
// @wt-script <目录>/<名称>       身份（与文件路径一致）
// @purpose <一句话职责>
// @origin  native | webgames-derived   规则思想来源透明化
// @usage  <调用方式>              （可执行脚本必填；common/ 库模块豁免）
// @exit   <退出码语义>            （可执行脚本必填；common/ 库模块豁免）
```

## 4. 全库统一契约

- **参数词汇表**：`--json`（stdout 输出纯机器结果，日志静默到 stderr）/ `--strict`（warning 升阻断）/ `--root <dir>`（扫描根覆盖，供自检夹具）/ `--update-baseline`（基线棘轮）/ `--changed`（编排器：git 变更 → 保守映射受影响检查器，未知路径回退全量）/ `--consume-duration <ms>`（检查器间结果复用，由编排器自动注入）/ `--help`（打印自身头注释）。禁止同一语义出现第二种参数名。
- **退出码**：`0`=PASS（含显式降级：SKIP/NOT_AVAILABLE 必须在结果中标明，禁止伪装成 PASS）；`1`=阻断（发现阻断级问题或 fail-closed）；`2`=配置/用法错误。
- **stdout 纪律**：可执行脚本在 `--json` 下 stdout 必须是单个 `wt-checker/v1` 信封 JSON；一切日志走 stderr。
- **统一 Finding**：`{ ruleId, severity(error|warning|info), module, file, location{line,column}, message, evidence, suggestedFix, source }`；`source` 溯源（internal-checker / auto-refactor / build / test / benchmark）。
- **规则 ID 命名空间**：`LAY-`（结构）/ `HC-`（硬编码）/ `SCR-`（脚本规范）/ `RCFG-`（审查配置元审查）/ `PERF-`（性能模式）/ `TB-`（测试预算）/ `ARF-`（auto-refactor 映射）/ `L0-`（构建测试）。

## 5. 新增检查器 Checklist

1. 在对应目录创建 `<verb>-<name>.mjs`（kebab-case），补齐头契约标签；
2. stdout 输出 `wt-checker/v1` 信封（复用 `common/result.mjs`），退出码符合 §4；
3. 在 `scripts/config/review-rules.json` 的 `checkers` 注册：id/layer/stage/timeoutMs/origin/ruleIds（声明↔实施双向核对由 `audit/review-config.mjs` 强制，孤儿/悬空由 `audit/script-standard.mjs` 阻断）；
4. 确定性优先：能用 AST/正则/依赖图判定的不做启发式；启发式默认提示级（非 --strict 不阻断）；
5. 若为 L5 外部能力：只允许经 `tooling/` 适配，外部配置进 `refactor-adapter.json`，禁止绝对路径。

## 6. 外部工具（auto-refactor）接入边界

- 唯一接触点：`scripts/tooling/refactor-adapter.mjs`；只依赖其**稳定外部契约**（`scan` 子命令 + `--root/--config/--format json` + ScanReport JSON 结构 + 0/1/2 退出码），不 import 内部模块、不修改其源码/配置。
- 路径参数化：环境变量 `WT_REFACTOR_CLI` > `refactor-adapter.json` 候选路径（项目相对）；禁止盘符路径入库。
- 故障隔离矩阵：工具缺失 → `NOT_AVAILABLE`（默认放行并显式留痕；CI 可用 `--strict` 收紧）；超时 → `TIMEOUT`（同上）；引擎崩溃 → `NOT_AVAILABLE`；**有输出但解析失败 → FAIL（fail-closed，损坏输出比无输出危险）**。
- **存量债务棘轮**（引擎 0.2.0 原生）：适配器透传 `--baseline/--update-baseline --baseline-granularity grouped`，按（分析器|规则|文件）分组比对——只有【新增】发现（默认 warning 及以上）阻断，存量保持提示级；基线文件 `scripts/config/refactor-baseline.json` 入库，禁止用 `--update-baseline` 消音。
- **豁免透明**（引擎 0.2.0 原生 suppressions）：清单在 `auto-refactor.config.json`，支持 matchFile/Analyzer/Rule/Symbol + `downgradeTo` 降级；降级项留在发现列表（理由随行），完全豁免进入 `suppressed` 列表——两者都不静默消失。

## 7. 常用命令

```bash
npm run review              # 全量审查 + 报告（reports/review/report-latest.{json,md}）
npm run review:gate         # CI 门禁模式（阻断即非零退出）
npm run review:strict       # 严格门禁（SKIP/NOT_AVAILABLE 也阻断）
npm run review:selftest     # 夹具自检：验证审查引擎确实能命中已知违规
npm run refactor:scan       # 单独运行 auto-refactor 适配层
node scripts/benchmark/test-budget.mjs --update-baseline   # 记录测试时长基线（仅应有理由时使用）
```

## 8. 元审查（审查审查系统）

- `audit/script-standard.mjs`：孤儿检查器 / 悬空注册 / 头契约漂移（含 `@origin` 来源声明）/ 命名漂移；
- `audit/review-config.mjs`：配置 schema、规则声明↔实施双向核对、**跨检查器规则 ID 归属冲突**、依赖矩阵路径存在性（防规则绑定旧路径永不触发）、工具 glob 命中数、外部工具路径健康；
- 编排器运行时校验：**信封身份核对**（检查器不得伪装他人 id）、发现结构校验（ruleId/severity/message 契约）、空跑拒绝（选择器未命中即 exit 2，禁止未执行输出 PASS）；
- `run-review.mjs --self-test`：构造含已知违规的临时夹具项目，断言 L2/L3/L4 引擎全部命中（验证"审查未实际执行却输出 PASS"不可能发生）。
