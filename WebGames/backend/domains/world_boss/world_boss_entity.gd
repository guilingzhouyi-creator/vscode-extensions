# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/world_boss/world_boss_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world_boss.json | 信号: EventBus 领域广播
# 职责说明: 单机游荡天灾与联机大型 Raid 首领 100% 同构模型、多段血槽与机制护盾契约 默认值由 config/domains/world_boss.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name WorldBossAggregate extends MonsterAggregateEntity

var boss_uid: String = GameConfig.get_string("domains.world_boss", "entity_defaults/boss_uid", "BOSS_WORLD_LEVIATHAN_01")
var boss_title: String = GameConfig.get_string("domains.world_boss", "entity_defaults/boss_title", "【天灾灭世者 · 灭烬巨龙】")
var total_phases: int = GameConfig.get_int("domains.world_boss", "entity_defaults/total_phases", 3)
var current_phase_index: int = GameConfig.get_int("domains.world_boss", "entity_defaults/current_phase_index", 1)

var phase_max_hp: float = GameConfig.get_float("domains.world_boss", "entity_defaults/phase_max_hp", 10000.0)
var phase_current_hp: float = GameConfig.get_float("domains.world_boss", "entity_defaults/phase_current_hp", 10000.0)

var mechanism_shield_hp: float = GameConfig.get_float("domains.world_boss", "entity_defaults/mechanism_shield_hp", 0.0)
var is_invulnerable: bool = GameConfig.get_bool("domains.world_boss", "entity_defaults/is_invulnerable", false)
var is_channeling_wipe_spell: bool = GameConfig.get_bool("domains.world_boss", "entity_defaults/is_channeling_wipe_spell", false)
var is_defeated: bool = false # L9-b（Phase 53）击败终态锁存：置位后重复受击不再结算（一次性语义 Inv-ON-1）

var battle_contribution_ledger: Dictionary = {}

## 世界首领聚合构造：统一六维底座（首领等级配置驱动）+ 灭烬巨龙默认种族
func _init() -> void:
	super._init()
	species_name = GameConfig.get_string("domains.world_boss", "entity_defaults/species_name", "灭烬巨龙")
	# 统一六维底座：首领默认等级（1~6，配置驱动；底层实际值经换算引擎得出）
	physiology.race_id = "WORLD_BOSS"
	physiology.set_level("STR", GameConfig.get_int("domains.world_boss", "entity_defaults/physiology/str_level", 5))
	physiology.set_level("CON", GameConfig.get_int("domains.world_boss", "entity_defaults/physiology/con_level", 6))
	physiology.set_level("VIT", GameConfig.get_int("domains.world_boss", "entity_defaults/physiology/vit_level", 6))
	physiology.lifespan_scale = GameConfig.get_float("domains.world_boss", "entity_defaults/physiology/lifespan_scale", 10.0)
