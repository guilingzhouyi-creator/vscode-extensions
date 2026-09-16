# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/quest_causality/quest_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: inventory | 配置: config/domains/quest.json | 信号: EventBus 领域广播
# 职责说明: 世界状态因果有向无环图 (Causality DAG) 目标状态判定契约。 默认方案类型/任务标题/奖励由 config/quest.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name QuestObjectiveNode extends RefCounted

var node_id: String = ""
var solution_type: String = GameConfig.get_string("domains.quest", "node_defaults/solution_type", "COMBAT_FORCE") # COMBAT_FORCE / STEALTH_THEFT / DIPLOMATIC_PERSUADE / BLACK_MARKET_SWAP
var target_state_key: String = ""
var required_value: Variant = null
var is_completed: bool = false
var prerequisite_nodes: Array = []

class QuestCausalityAggregate extends RefCounted:
	var quest_id: String = ""
	var quest_title: String = GameConfig.get_string("domains.quest", "quest_defaults/quest_title", "净化古老遗迹")
	var objective_nodes: Dictionary = {} # node_id -> QuestObjectiveNode
	var solution_paths: Array = [] # [[node1, node2], [node3]] 代表多手段完成分支
	var faction_reputation_rewards: Dictionary = GameConfig.get_dict("domains.quest", "quest_defaults/faction_reputation_rewards", { "EMPIRE": 50, "REBELS": -25 })
	var gold_reward: int = GameConfig.get_int("domains.quest", "quest_defaults/gold_reward", 500)
	var is_quest_finished: bool = false
