---
name: test-benchmark-engineering
description: >-
  【触发：写单测/TDD/红绿测试/基准测试/性能回归/耗时棘轮/孤儿用例】编写单元测试、性能压测或实行 TDD 时必须使用。先写失败用例，隔离确定性时钟与伪随机种子，看守单调耗时预算与零孤儿用例。
---

# test-benchmark-engineering — 测试驱动开发、确定性隔离与基准棘轮规范

本技能将**测试驱动开发（TDD 红-绿-重构闭环）**、**确定性环境隔离（时钟/PRNG/沙箱虚拟化）**、**全仓零孤儿用例纳管**以及**性能基准单调耗时棘轮（`TB-REGRESSION`）**整合为统一的测试工程化体系。

---

<!-- SKILL-LINKS:BEGIN -->
## 联动技能

> 本节由 `scripts/common/sync-skill-metadata.js` 依 `scripts/common/skill-registry.json` 生成，禁止手改。

| 联动关系 | 技能 |
| :--- | :--- |
| **定位** | 分形版本控制内核（链上第 5 步）；自动重构内核（链上第 5 步）；VS Code 扩展与计时视图（链上第 4 步）；游戏引擎与 Godot 视图（链上第 4 步）；门禁与命令面基础设施（链上第 4 步）；工作区元治理与并行交付（领域支援） |
| **前置** | [algorithmic-operator-engineering](../algorithmic-operator-engineering/SKILL.md)、[telemetry-statistical-modeling](../telemetry-statistical-modeling/SKILL.md)、[interaction-design-physics](../interaction-design-physics/SKILL.md)、[coding-craft](../coding-craft/SKILL.md) |
| **接续** | [release-package-workflow](../release-package-workflow/SKILL.md) |
| **并行支援** | [constraint-driven-development](../constraint-driven-development/SKILL.md)、[debugging-and-error-recovery](../debugging-and-error-recovery/SKILL.md)、[complexity-budget](../complexity-budget/SKILL.md)、[spec-driven-development](../spec-driven-development/SKILL.md) |
| **领域链** | 分形版本控制内核：fractal-git-dev → rust-engineering → state-concurrency-and-crash-recovery → algorithmic-operator-engineering → test-benchmark-engineering；其余领域链见 `docs/skill-catalog.md` |

**何时联动**：新增或修改 taxis 子命令 → `fractal-git-dev` + `rust-engineering` + `test-benchmark-engineering`；taxis 输出与 git 逐字节不一致 → `fractal-git-dev` + `debugging-and-error-recovery` + `algorithmic-operator-engineering`
<!-- SKILL-LINKS:END -->

## 一、 适用场景与触发条件

1. **新增业务逻辑或修复缺陷**：执行红-绿-重构闭环（先写复现缺陷或验证契约的失败用例，亲眼确认红灯后再写最小实现）；
2. **时钟、随机与外部 I/O 隔离**：涉及跨午夜、定时器、随机抽样或文件系统沙箱的确定性测试；
3. **性能微基准与耗时回归排查**：为高频算子编写基准或排查 `TB-REGRESSION` 超时阻断；
4. **测试套件注册与防孤儿核查**：确保所有新增测试纳入对应子项目总清单。

---

## 二、 核心 TDD 红-绿-重构闭环与确定性隔离公理

```text
1. 红灯 (RED): 编写确定性失败用例并验证红灯 ──▶ 2. 绿灯 (GREEN): 最小生产实现使测试变绿 ──▶ 3. 重构 (REFACTOR): 平铺控制流并过三重门禁
```

| 隔离维度 | 刚性契约指标 | 架构职责与防范目标 |
| :--- | :--- | :--- |
| **时钟虚拟化** | `withFixedNow` / 注入 `Clock` | 锁定离散时间基准点，严禁直调 `Date.now()` 导致跨午夜或延迟抖动（`TST-DEN-001`） |
| **伪随机数种子** | 固定种子 PRNG (Mulberry32) | 随机测试固定初始化 Seed，严禁无种子 `Math.random()`，确保失败 100% 可复现 |
| **异步竞态规避** | 零硬编码 `sleep` / 内存桩 | 单元测试 100% 内存化隔离外部 I/O；异步等待使用条件驱动，禁止 `setTimeout(100)` 盲等 |
| **沙箱与并发汇合** | `try/finally` + `pump()/flush()` | 临时目录写于 `os.tmpdir()` 并在 `finally` 清理；后台派发器在测试结束前显式排空 |
| **断言有效性** | 禁 `it.skip` 与同义反复断言 | 严禁跳过用例（`TST-SKP-001`）或仅断言 `toBeTruthy()`（`TST-TAU-001`） |

> **测试通过非达标公理**：测试全绿仅为逻辑未断裂的最低底线；交割前必须同时通过静态编译、复杂度体积预算（$\text{CC}\le 15, \text{Depth}\le 4$）与全仓静态门禁审查。

---

## 三、 全仓零孤儿用例纳管 (`TST-ORC-001`) 与耗时棘轮 (`TB-REGRESSION`)

1. **四大受控项目全量纳管**：
   - **`auto-refactor`**：规则与单元用例必须在 `scripts/test-parallel.js` 注册，保障 <!-- METRICS:BEGIN test-suite-count -->**180 套**<!-- METRICS:END test-suite-count -->测试并发/串行全绿且 TS/Rust 100% 字节等价；
   - **`workspace-timing`**：`src/test/` 下 <!-- METRICS:BEGIN ws-test-case-count -->**205 项**<!-- METRICS:END ws-test-case-count -->单元测试由 `npm run test:fast` 与 `npm run review` 全量覆盖；
   - **`WebGames`**：继承 `TestCase` 并在 `config/infrastructure/domains.json` 与 `test_registry.gd` 双向注册，严禁 `tests/unit/` 根目录散落脚本；
   - **`fractal-git`**：10 微 Crate 测试与并发 CAS/零分配校验统一纳管于 Cargo Workspace 与 `audit-taxis.ps1`。
2. **性能耗时棘轮 (`TB-REGRESSION`) 与超时尾日志转储**：
   - 纯逻辑单测单项 $\le 10\text{ms}$；本地流式门禁内存判定约 $1\text{ms}$、端到端（含 Node 启动约 $80\text{ms}$）约 $160\text{ms}$；
   - 套件总耗时受 $1.15 \times \text{Baseline}$ 单调棘轮约束，超限触发 `TB-REGRESSION` 阻断；
   - 子进程或无头测试超时被杀时，驱动脚本必须自动截取并打印临时日志末尾最后 50 行以暴露死锁调用栈。

---

## 四、 常用验证命令与参考资产

```bash
cd auto-refactor && npm test && node scripts/bench-hot-paths.js
cd workspace-timing && npm run test:fast
pwsh -File fractal-git/scripts/ps1/audit-taxis.ps1
```

- [deterministic-test-isolation.md](references/deterministic-test-isolation.md)：时钟/PRNG 虚拟化、内存存储桩与 `TB-REGRESSION` 单调耗时棘轮深度指南；
- [deterministic-unit-test.ts](templates/deterministic-unit-test.ts)：红-绿-重构确定性单元测试标准样板；
- [benchmark-suite-skeleton.js](templates/benchmark-suite-skeleton.js)：热路径性能微基准套件标准骨架。
