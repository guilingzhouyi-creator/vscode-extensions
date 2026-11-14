# 确定性沙盒与三态回放校验 (`deterministic_sandbox`)

> 对应源码：`backend/domains/deterministic_sandbox/`（3 个 `.gd`）。负责单机/预测/权威三态隔离流转、防 AP 透支与脱同步异常检测，以及基于固定 LCG 序列的状态指纹比对与能量守恒审计。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置驱动 |
| :--- | :--- | :--- | :--- |
| [authority_tri_state_machine.gd](../../../../backend/domains/deterministic_sandbox/authority_tri_state_machine.gd) | `AuthorityTriStateMachine` | 权威三态流转状态机 | 定义 `AuthorityMode`（单机/预测/权威）；提供 `transition_mode()` 与 `audit_input_continuity()` 检测 `ap_overflow_threshold` 及 `max_allowed_desync_ticks` |
| [deterministic_input_snapshot.gd](../../../../backend/domains/deterministic_sandbox/deterministic_input_snapshot.gd) | `DeterministicInputSnapshot` | 帧同步输入快照实体 | 记录 `tick` 对齐编号、输入指令、随机种子并支持 `serialize()` |
| [deterministic_replay_engine.gd](../../../../backend/domains/deterministic_sandbox/deterministic_replay_engine.gd) | `DeterministicReplayEngine` | 无状态确定性回放引擎 | `simulate_replay()` 生成标准化系统状态指纹（`fingerprint/format`）；`verify_energy_conservation()` 执行伤害能量守恒差值断言 |

---

## 二、关联配置与验证

- **配置映射**：`domains.deterministic.core`（别名 `domains.deterministic`，同时承载全引擎 `DeterministicRNG` 的 `lcg/*` 默认参数）与 `narratives.deterministic`。
- **测试入口**：[test_deterministic_sandbox.gd](../../../../tests/unit/domains/test_deterministic_sandbox.gd)。
