# 特性开关、灰度放量与故障熔断 (`feature_toggle_canary`)

> 对应源码：`backend/domains/feature_toggle_canary/`（3 个 `.gd`）。提供基于账号确定性哈希桶（0~99）的灰度放量计算、白名单优先裁决、失败次数触发自动熔断开关以及调试命令热修改能力。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 核心接口与配置键 |
| :--- | :--- | :--- | :--- |
| [feature_toggle_aggregate.gd](../../../../backend/domains/feature_toggle_canary/feature_toggle_aggregate.gd) | `FeatureToggleAggregate` | 开关策略聚合根 | 定义 `RolloutStrategy` 枚举及 `register_flag()`、`get_flag()` |
| [canary_rollout_solver.gd](../../../../backend/domains/feature_toggle_canary/canary_rollout_solver.gd) | `CanaryRolloutSolver` | 灰度分桶与熔断裁决 | `is_feature_enabled_for_account()`、`report_feature_failure()`（超过 `circuit_breaker/max_tolerable_failures` 自动切断特性） |
| [feature_debug_pipeline.gd](../../../../backend/domains/feature_toggle_canary/feature_debug_pipeline.gd) | `FeatureDebugPipeline` | 调试开关调整管线 | `apply_debug_command()` |

---

## 二、关联配置与验证

- **配置映射**：`domains.feature_toggle_canary.core`、`narratives.feature_toggle_canary`。
- **测试入口**：[test_feature_toggle_canary.gd](../../../../tests/unit/domains/test_feature_toggle_canary.gd)。
