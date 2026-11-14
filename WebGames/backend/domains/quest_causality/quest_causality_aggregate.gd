# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/quest_causality/quest_causality_aggregate.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: CausalityDagSolver, FactionBountyAndCausalityFSM | 下游: QuestObjectiveNode, GameConfig
# 职责说明: 任务因果聚合根实体模型，管理多分支目标节点与阵营声望奖励。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## QuestCausalityAggregate：任务因果聚合根实体模型，管理多分支目标节点与阵营声望奖励。
class_name QuestCausalityAggregate
extends RefCounted

var quest_id: String = ""
var quest_title: String = GameConfig.get_string(
	"domains.quest",
	"quest_defaults/quest_title",
	"净化古老遗迹"
)
var objective_nodes: Dictionary = {} # node_id -> QuestObjectiveNode
var solution_paths: Array = [] # [[node1, node2], [node3]] 代表多手段完成分支
var faction_reputation_rewards: Dictionary = GameConfig.get_dict(
	"domains.quest",
	"quest_defaults/faction_reputation_rewards",
	{
		"EMPIRE": 50,
		"REBELS": -25
	}
)
var gold_reward: int = GameConfig.get_int(
	"domains.quest",
	"quest_defaults/gold_reward",
	500
)
var is_quest_finished: bool = false
