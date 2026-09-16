# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/npc_simulation/npc_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/npc.json | 信号: EventBus 领域广播
# 职责说明: NPC 与玩家 100% 同构底座、五维性格矩阵 (Big-5) 与社交羁绊图谱。 默认姓名/性格/初始目标由 config/npc.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name AutonomousNPCEntity extends RefCounted

var npc_id: String = ""
var personal_name: String = GameConfig.get_string("domains.npc", "defaults/personal_name", "老剑客艾尔顿")

# 五维性格特征矩阵 (0.0 ~ 1.0)
var personality: Dictionary = GameConfig.get_dict("domains.npc", "defaults/personality", {
	"courage": 0.8,     # 胆识 (勇猛 vs 怯懦)
	"greed": 0.3,       # 贪婪 (求财 vs 清心)
	"benevolence": 0.7, # 仁慈 (济世 vs 残忍)
	"rationality": 0.9, # 理智 (谋定 vs 冲动)
	"piety": 0.4        # 虔诚 (信徒 vs 异端)
})

# 100% 同构底层组件
var physiology: CharacterPhysiologySheet = null
var wallet: CharacterWalletEntity = null
var social_bonds: Dictionary = {} # target_id -> { "relation": "DISCIPLE", "affinity": 75 }
var current_goal: String = GameConfig.get_string("domains.npc", "defaults/current_goal", "IDLE")

## NPC 构造：100% 同构生理/钱包组件装配（默认性格配置驱动）
func _init() -> void:
	physiology = CharacterPhysiologySheet.new()
	wallet = CharacterWalletEntity.new()
