---
name: test-benchmark-engineering
description: >-
  测试工程化、确定性隔离与性能基准回归守卫规范。指导 Agent 落实跨项目防孤儿用例管理、
  固定时钟与伪随机数确定性环境隔离、基准套件耗时回归棘轮 (TB-REGRESSION)、
  以及 auto-refactor 325 规则全量自测与 workspace-timing 145 用例防护。
---

# test-benchmark-engineering — 测试工程化、确定性隔离与基准回归工作流

本技能确立了全工作区测试套件工程化标准、测试用例防孤儿纳管机制、时钟与随机数虚拟化隔离原则以及**性能基准单调耗时棘轮（`TB-REGRESSION`）**防线。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **编写或重构单元测试与集成测试**：为新功能补齐测试用例，重构既有测试消除偶发脆弱性（Flakiness）；
2. **测试时钟与随机数虚拟化**：涉及跨天、跨时区、定时器调度、会话休眠或随机算法逻辑测试；
3. **性能微基准与耗时测试编写**：为高频核心循环或 AST 分析算子编写微基准并看守耗时预算；
4. **测试清单纳管与孤儿排查**：新增测试文件后确保其纳入对应子项目自测套件，严禁平铺孤儿测试；
5. **门禁拦截排查**：触发测试失败、测试超时或性能基准退化告警（`TB-REGRESSION`）。

---

## 二、 确定性测试隔离公理 (Deterministic Isolation)

所有自动化测试必须具备 100% 确定性，严禁因宿主环境抖动导致偶发失败：

| 隔离维度 | 刚性契约指标 | 架构职责与防范目标 |
| :--- | :--- | :--- |
| **时钟虚拟化** | `withFixedNow` / fakeTimers | 必须锁定离散时间基准点，严禁直接依赖系统物理时钟造成跨午夜/跨时区竞态 |
| **伪随机数种子** | 固定种子 PRNG (Mulberry32) | 随机测试必须采用固定 Seed 初始化，确保失败用例能够 100% 稳定复现 |
| **异步竞态规避** | 零硬编码固定延时 (`sleep`) | 严禁使用固定 `setTimeout(100)` 盲等异步结果，必须通过 Promise 条件自愈等待 |
| **沙箱临时文件** | 独立隔离并强制清理 | 测试临时文件写入带随机后缀的独立目录，在 `finally`/`afterEach` 中干净清理 |

---

## 三、 防孤儿用例与清单注册机制 (Zero Orphan Tests)

工作区对测试用例实行严格的**全量纳管、零孤儿用例**原则：

1. **`auto-refactor` (325 规则自测全纳管)**：
   - 规则自测用例位于 `auto-refactor/tests/rules/`；
   - 必须在 `auto-refactor/scripts/test-parallel.js` 或并行自测清单中注册；
   - 保证 153/153 套测试套件并发绿色通过，0 挂起，纯 TS shim 与 Rust 算子 100% 字节等价。
2. **`workspace-timing` (145 单元测试全纳管)**：
   - 单元测试位于 `workspace-timing/src/test/`；
   - 必须通过 `npm run test:fast` 极速套件与 `npm run review` 全量覆盖；
   - 必须覆盖跨午夜、RingBuffer 满载清退与 StorageCoordinator 级联兜底边界。
3. **`WebGames` (全域测试清单纳管)**：
   - 所有测试套件继承 `TestCase`，并在 `config/infrastructure/domains.json` 与 `test_registry.gd` 中双向注册；
   - 严禁在 `tests/unit/` 根目录平铺散落未注册脚本。

---

## 四、 性能基准与回归耗时棘轮 (`TB-REGRESSION`)

为了保护极速开发体验与自动化门禁性能，测试耗时受到单调棘轮机制看守：

### 1. 单用例耗时上限
- 纯逻辑单元测试单项耗时应严格控制在 $10\text{ms}$ 以内；
- 内存流式预审门禁全量判定耗时控制在 $100\text{ms}$ 级（如 `gate-fast-staged.js < 90ms`）。

### 2. 基准耗时棘轮与阻断 (`TB-REGRESSION`)
- 子项目测试基线记录历史测试耗时快照；
- 允许 $15\%$ 的环境硬件测量波动容差；
- 若单次改动导致套件总耗时突破容差阈值，触发 `TB-REGRESSION` 警告与门禁阻断，强制排查未释放的定时器或死循环。

---

## 五、 常用测试运行与验证命令矩阵

```bash
# 1. auto-refactor 全量测试套件 (153/153 并发通过)
cd auto-refactor && npm test

# 2. workspace-timing 极速单元测试 (145 项用例通过)
cd workspace-timing && npm run test:fast

# 3. auto-refactor 规则自审棘轮基线看守
node auto-refactor/scripts/gate-self.js

# 4. 全工作区统一质量审查 (含全项目测试与基准验证)
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

**质性断言标准**：
- auto-refactor 153/153 套测试绿色通过，0 孤儿用例；
- workspace-timing 145 项单元测试 100% 通过；
- 测试过程零未决异步句柄挂起，环境沙箱自动清理干净；
- 全工作区 High/Critical 技术债务保持 0 项基线，严禁引入技术债务反弹。

---

## 六、 关联模板与参考指引

- [deterministic-test-isolation.md](references/deterministic-test-isolation.md)：确定性测试隔离与时钟/RNG 虚拟化指南；
- [test-duration-ratchet-mechanics.md](references/test-duration-ratchet-mechanics.md)：测试耗时基准棘轮与防回归机制；
- [deterministic-unit-test.ts](templates/deterministic-unit-test.ts)：确定性单元测试标准样板代码；
- [benchmark-suite-skeleton.js](templates/benchmark-suite-skeleton.js)：性能微基准套件标准骨架。

