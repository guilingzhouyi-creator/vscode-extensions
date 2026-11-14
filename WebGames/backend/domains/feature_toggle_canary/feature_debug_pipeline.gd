# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/feature_toggle_canary/feature_debug_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/feature_toggle_canary.json | 信号: EventBus 领域广播
# 职责说明: 响应 GM / 开发者调试指令，动态热修改特性开关策略与灰度比例
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## FeatureDebugPipeline：Business Pipeline / Transaction Safe Orchestrator
class_name FeatureDebugPipeline
extends RefCounted

## GM 调试指令应用：动态热改开关策略/灰度比例/熔断复位（未知指令拒绝）
static func apply_debug_command(
	toggle_manager: FeatureToggleAggregate,
	command: String,
	feature_key: String,
	parameter_value: Variant = null
) -> Dictionary:
	var feature_flag: Variant = toggle_manager.get_flag(feature_key)
	if feature_flag == null:
		feature_flag = FeatureToggleAggregate.FeatureFlagEntry.new(feature_key)
		toggle_manager.register_flag(feature_flag)

	match command:
		"ENABLE_GLOBAL":
			feature_flag.strategy = FeatureToggleAggregate.RolloutStrategy.GLOBAL_ENABLED
			feature_flag.is_circuit_broken = false
			return { "success": true, "feature_key": feature_key, "strategy": "GLOBAL_ENABLED" }
		"DISABLE_GLOBAL":
			feature_flag.strategy = FeatureToggleAggregate.RolloutStrategy.GLOBAL_DISABLED
			return { "success": true, "feature_key": feature_key, "strategy": "GLOBAL_DISABLED" }
		"SET_PERCENTAGE":
			var threshold_percent := clampi(int(parameter_value), 0, 100)
			feature_flag.strategy = FeatureToggleAggregate.RolloutStrategy.PERCENTAGE_CANARY
			feature_flag.rollout_percentage = threshold_percent
			feature_flag.is_circuit_broken = false
			return { "success": true, "feature_key": feature_key, "percentage": threshold_percent }
		"RESET_CIRCUIT_BREAKER":
			feature_flag.is_circuit_broken = false
			feature_flag.failure_count = 0
			return { "success": true, "feature_key": feature_key, "status": "RESET_OK" }

	return { "success": false, "error_code": "UNKNOWN_COMMAND" }
