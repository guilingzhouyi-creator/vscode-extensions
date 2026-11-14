# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/monster_ecology/monster_body_part.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: MonsterAggregateEntity, MonsterEcologySolver | 下游: GameConfig | 配置: config/domains/monster.json
# 职责说明: 怪物身体部位实体结构，描述耐久度、部位破坏状态与行动点惩罚。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## MonsterBodyPart：怪物身体部位实体结构，描述耐久度、部位破坏状态与行动点惩罚。
class_name MonsterBodyPart
extends RefCounted

var part_id: String = GameConfig.get_string(
	"domains.monster",
	"body_part_defaults/part_id",
	"HEAD"
) # HEAD / TORSO / LIMB_LEFT / LIMB_RIGHT / WING / HEART_CORE
var part_name: String = GameConfig.get_string(
	"domains.monster",
	"body_part_defaults/part_name",
	"头颅"
)
var durability_current: float = GameConfig.get_float(
	"domains.monster",
	"body_part_defaults/durability",
	100.0
)
var durability_max: float = GameConfig.get_float(
	"domains.monster",
	"body_part_defaults/durability",
	100.0
)
var is_severed: bool = false
var ap_penalty_on_break: int = GameConfig.get_int(
	"domains.monster",
	"body_part_defaults/ap_penalty_on_break",
	2
)
