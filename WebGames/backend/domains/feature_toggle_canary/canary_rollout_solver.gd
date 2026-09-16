# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/feature_toggle_canary/canary_rollout_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/feature_toggle_canary.json | 信号: EventBus 领域广播
# 职责说明: 确定性哈希散列分流计算 (0~99 Bucket)、白名单优先判定与崩溃自动熔断
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name CanaryRolloutSolver
extends RefCounted

## 特性开关判定：熔断/全局禁用/白名单/百分比灰度的确定性哈希分桶
static func is_feature_enabled_for_account(
	flag: FeatureToggleAggregate.FeatureFlagEntry,
	account_id: String
) -> bool:
	if flag == null or flag.is_circuit_broken:
		return false

	match flag.strategy:
		FeatureToggleAggregate.RolloutStrategy.GLOBAL_DISABLED:
			return false
		FeatureToggleAggregate.RolloutStrategy.GLOBAL_ENABLED:
			return true
		FeatureToggleAggregate.RolloutStrategy.WHITELIST_ONLY:
			return flag.whitelist_account_ids.has(account_id)
		FeatureToggleAggregate.RolloutStrategy.PERCENTAGE_CANARY:
			if flag.whitelist_account_ids.has(account_id):
				return true
			# 确定性哈希散列
			var seed_str = account_id + ":" + flag.feature_key
			var bucket = int(abs(seed_str.hash())) % _bucket_size()
			return bucket < flag.rollout_percentage

	return false

## 失败上报与熔断：计数达阈值置熔断并告警
static func report_feature_failure(
	flag: FeatureToggleAggregate.FeatureFlagEntry,
	max_tolerable_failures: int = -1   # <0 表示取配置默认值 circuit_breaker/max_tolerable_failures
) -> Dictionary:
	if flag == null:
		return { "circuit_broken": false, "current_failures": 0 }

	if max_tolerable_failures < 0:
		max_tolerable_failures = _max_tolerable_failures()

	flag.failure_count += 1
	if flag.failure_count >= max_tolerable_failures:
		flag.is_circuit_broken = true
		return {
			"circuit_broken": true,
			"feature_key": flag.feature_key,
			"message": _msg("circuit_breaker_tripped") % [flag.feature_key, flag.failure_count]
		}
	return { "circuit_broken": false, "current_failures": flag.failure_count }

# ==============================================================================
# 配置读取
# ==============================================================================

static func _msg(key: String) -> String:
	return GameConfig.msg("feature_toggle_canary", key)

## 分桶基数。配置可热重载，若被改成 0 会导致下游 `% _bucket_size()` 整数模零崩溃，
## 因此在此处钳制下界——配置驱动不等于放弃边界校验。
static func _bucket_size() -> int:
	var size := GameConfig.get_int("domains.feature_toggle_canary", "canary/bucket_size", 100)
	return maxi(1, size)

## 熔断失败阈值（circuit_breaker/max_tolerable_failures 配置，默认 3）
static func _max_tolerable_failures() -> int:
	return GameConfig.get_int("domains.feature_toggle_canary", "circuit_breaker/max_tolerable_failures", 3)
