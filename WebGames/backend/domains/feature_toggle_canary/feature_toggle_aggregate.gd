# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/feature_toggle_canary/feature_toggle_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/feature_toggle_canary.json | 信号: EventBus 领域广播
# 职责说明: 特性开关矩阵聚合根、策略分级定义与熔断故障状态追踪
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name FeatureToggleAggregate
extends RefCounted

enum RolloutStrategy {
	GLOBAL_DISABLED,    # 全局关闭 (0%)
	WHITELIST_ONLY,     # 仅白名单测试员可见
	PERCENTAGE_CANARY,  # 百分比灰度分流 (1%~99%)
	GLOBAL_ENABLED      # 全量开放 (100%)
}

class FeatureFlagEntry extends RefCounted:
	var feature_key: String = ""            # 如 "FEATURE_2D_CONTINUOUS_MOVEMENT"
	var strategy: RolloutStrategy = RolloutStrategy.GLOBAL_DISABLED
	var rollout_percentage: int = 0         # 0~100
	var whitelist_account_ids: Array = []
	var is_circuit_broken: bool = false     # 是否已被熔断器强制关闭
	var failure_count: int = 0              # 崩溃计数

	## 特性开关条目构造（键/策略/百分比/白名单）
	func _init(
		p_key: String = "",
		p_strat: RolloutStrategy = RolloutStrategy.GLOBAL_DISABLED,
		p_pct: int = 0,
		p_whitelist: Array = []
	) -> void:
		feature_key = p_key
		strategy = p_strat
		rollout_percentage = p_pct
		whitelist_account_ids = p_whitelist

# feature_key -> FeatureFlagEntry
var flags_registry: Dictionary = {}

## 登记特性开关条目（按 feature_key 索引）
func register_flag(flag: FeatureFlagEntry) -> void:
	flags_registry[flag.feature_key] = flag

## 按键取开关条目（未登记返回 null）
func get_flag(feature_key: String) -> FeatureFlagEntry:
	return flags_registry.get(feature_key, null)
