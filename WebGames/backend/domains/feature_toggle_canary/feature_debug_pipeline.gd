# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/feature_toggle_canary/feature_debug_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/feature_toggle_canary.json | 信号: EventBus 领域广播
# 职责说明: 响应 GM / 开发者调试指令，动态热修改特性开关策略与灰度比例
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name FeatureDebugPipeline
extends RefCounted

## GM 调试指令应用：动态热改开关策略/灰度比例/熔断复位（未知指令拒绝）
static func apply_debug_command(
	toggle_manager: FeatureToggleAggregate,
	command: String,
	feature_key: String,
	param_value: Variant = null
) -> Dictionary:
	var flag = toggle_manager.get_flag(feature_key)
	if flag == null:
		flag = FeatureToggleAggregate.FeatureFlagEntry.new(feature_key)
		toggle_manager.register_flag(flag)

	match command:
		"ENABLE_GLOBAL":
			flag.strategy = FeatureToggleAggregate.RolloutStrategy.GLOBAL_ENABLED
			flag.is_circuit_broken = false
			return { "success": true, "feature_key": feature_key, "strategy": "GLOBAL_ENABLED" }
		"DISABLE_GLOBAL":
			flag.strategy = FeatureToggleAggregate.RolloutStrategy.GLOBAL_DISABLED
			return { "success": true, "feature_key": feature_key, "strategy": "GLOBAL_DISABLED" }
		"SET_PERCENTAGE":
			var pct = clampi(int(param_value), 0, 100)
			flag.strategy = FeatureToggleAggregate.RolloutStrategy.PERCENTAGE_CANARY
			flag.rollout_percentage = pct
			flag.is_circuit_broken = false
			return { "success": true, "feature_key": feature_key, "percentage": pct }
		"RESET_CIRCUIT_BREAKER":
			flag.is_circuit_broken = false
			flag.failure_count = 0
			return { "success": true, "feature_key": feature_key, "status": "RESET_OK" }

	return { "success": false, "error_code": "UNKNOWN_COMMAND" }
