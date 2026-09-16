# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/narrative_event_aggregate.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 剧情因果节点聚合根，包含三级拓扑 (世界/地缘/个人)、AST 条件树与因果突变动作
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name NarrativeEventAggregate
extends RefCounted

enum EventScopeTier {
	WORLD_HISTORICAL,   # 世界史诗纪元大事件 (天灾/政变)
	REGIONAL_TOWN,      # 地缘城镇生态事件 (兽潮/商荒)
	PERSONAL_ENCOUNTER  # 个人奇遇与私密因果
}

var event_id: String = ""                        # 事件唯一 ID (如 "EVT_IMPERIAL_COUP_STAGE_1")
var event_title: String = ""                     # 事件标题
var event_scope: EventScopeTier = EventScopeTier.REGIONAL_TOWN
var priority_weight: int = GameConfig.get_int("domains.narrative_orchestration", "defaults/priority_weight", 100)                   # 优先级权重 (冲突仲裁，越高越优先)

# 前置条件规则表达式树
# {"type": "AND", "conditions": [
#    {"kind": "TOWN_EQUALS", "val": "TOWN_VALAN"},
#    {"kind": "MIN_LEVEL", "val": 10}
# ]}
var trigger_conditions_ast: Dictionary = {}

# 触发后产生的因果突变动作
# [{"action": "SPAWN_BOSS", "boss_id": "VOID_SPECTER"}, {"action": "MODIFY_MARKET_TAX", "delta": 0.15}]
var payload_actions: Array[Dictionary] = []

var is_repeatable: bool = false
var has_triggered: bool = false
var triggered_timestamp_utc: int = 0

## 因果事件聚合构造（ID/标题/作用域/优先级）
func _init(
	p_id: String = "",
	p_title: String = "",
	p_scope: EventScopeTier = EventScopeTier.REGIONAL_TOWN,
	p_priority: int = 100
) -> void:
	event_id = p_id
	event_title = p_title
	event_scope = p_scope
	priority_weight = p_priority
