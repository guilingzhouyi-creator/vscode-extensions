# 运营凭证核销、风控与补偿管线 (`cdkey_voucher`)

> 对应源码：`backend/domains/cdkey_voucher/`（6 个 `.gd`）。承担正式运营版 CDKey 凭证核销的全生命周期：防爆破频控锁定、可配置复合资格门槛求值、一次性/广播全局核销上限判定、幂等核销流转以及经邮件附件发放的掉线补偿重试机制。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与机制说明 |
| :--- | :--- | :--- | :--- |
| [cdkey_voucher_aggregate.gd](../../../../backend/domains/cdkey_voucher/cdkey_voucher_aggregate.gd) | `CDKeyVoucherAggregate` | 凭证聚合根 | 定义 `VoucherType`、时效窗口 `valid_from_utc`/`valid_to_utc` 与全服领取次数上限 |
| [cdkey_eligibility_rule_engine.gd](../../../../backend/domains/cdkey_voucher/cdkey_eligibility_rule_engine.gd) | `CDKeyEligibilityRuleEngine` | 声明式复合门槛引擎 | `load_rules()`、`merge_rules()`、`evaluate()` 执行 `AND/OR` 短路求值而不硬编码业务条件 |
| [cdkey_redemption_dto.gd](../../../../backend/domains/cdkey_voucher/cdkey_redemption_dto.gd) | `CDKeyRedemptionDTO` | 兑换与回滚上下文 DTO | 收口兑换所需主体与回滚字段 |
| [cdkey_redemption_solver.gd](../../../../backend/domains/cdkey_voucher/cdkey_redemption_solver.gd) | `CDKeyRedemptionSolver` | 核销与频控裁决器 | `resolve_redemption()`、`rollback_redemption()`、`purge_expired_rate_limits()`（含 `max_failed_attempts`/`lockout_duration_seconds` 锁控） |
| [redemption_flow_orchestrator.gd](../../../../backend/domains/cdkey_voucher/redemption_flow_orchestrator.gd) | `RedemptionFlowOrchestrator` | 核销事务补偿编排器 | `process_redemption()`、`retry_dispatch()`、`compensate_stale_pending()` 实现“去重 -> 核销落账 -> 邮件投递 -> 悬挂补偿”闭环 |
| [voucher_dispatch_pipeline.gd](../../../../backend/domains/cdkey_voucher/voucher_dispatch_pipeline.gd) | `VoucherDispatchPipeline` | 邮件附件唯一发放出口 | `dispatch_rewards_via_mail()` 将货币和注册表物品打包发往收件箱 |

---

## 二、关联配置与验证

- **配置映射**：`domains.cdkey_voucher.core` 与 `narratives.cdkey_voucher`。
- **测试入口**：[test_cdkey_voucher.gd](../../../../tests/unit/domains/test_cdkey_voucher.gd)、[test_cdkey_eligibility.gd](../../../../tests/unit/infrastructure/test_cdkey_eligibility.gd)。
