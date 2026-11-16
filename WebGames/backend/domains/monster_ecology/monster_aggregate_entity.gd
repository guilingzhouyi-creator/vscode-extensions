# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/monster_ecology/monster_aggregate_entity.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/monster.json | 信号: EventBus 领域广播
# 职责说明: 怪物微观生理与玩家 100% 同构模型、多部位碰撞破坏体与基因吞噬池。 部位默认属性与物种生理初值由 config/domains/monster.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## MonsterAggregateEntity：Domain Logic Component
class_name MonsterAggregateEntity extends RefCounted

var monster_id: String = ""
var species_name: String = GameConfig.get_string("domains.monster", "species_defaults/species_name", "双足飞龙")
var physiology: CharacterPhysiologySheet = null
var body_parts: Dictionary = {} # part_id -> MonsterBodyPart
var devoured_genes: Array = []
var rage_level: float = 0.0 # 0.0 ~ 100.0

## 怪物聚合构造：统一六维属性体系（物种默认等级配置驱动）+ 生理模型装配
func _init() -> void:
	physiology = CharacterPhysiologySheet.new()
	physiology.race_id = "MONSTER"
	# 统一六维属性体系：物种默认等级（1~6，配置驱动；底层实际值经换算引擎得出）
	physiology.set_level("STR", GameConfig.get_int("domains.monster", "species_defaults/str_level", 3))
	physiology.set_level("CON", GameConfig.get_int("domains.monster", "species_defaults/con_level", 2))
	physiology.set_level("VIT", GameConfig.get_int("domains.monster", "species_defaults/vit_level", 4))
