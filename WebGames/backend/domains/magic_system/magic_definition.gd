# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_definition.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 描述魔法本体：canonical 标识、施法形态（引用 MagicTierSnapshot.MagicForm）、 属性归属（引用 magic_rules 属性体系）、基础位阶（独立维度，引用阶位梯度）、 效果参数键。位阶是独立数据维度，升格/降格不复制本实体。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## MagicDefinition：Domain Logic Component
class_name MagicDefinition
extends RefCounted

const DEFAULT_FORM: int = MagicTierSnapshot.MagicForm.INCANTATION
const RANK_MIN: int = 1
const RANK_MAX: int = 11

var canonical_id: String = ""
var magic_form: int = DEFAULT_FORM          # MagicTierSnapshot.MagicForm
var attribute_id: String = ""               # magic_rules attributes 键
var base_rank: int = RANK_MIN               # MagicTierSnapshot.MagicRank 数值 1~11
var effect_profile: String = ""             # 结算参数配置键（魔法效果真源引用）

## 序列化魔法定义为字典（枚举转整型）
func to_dto() -> Dictionary:
	return {
		"canonical_id": canonical_id,
		"magic_form": int(magic_form),
		"attribute_id": attribute_id,
		"base_rank": int(base_rank),
		"effect_profile": effect_profile,
	}

## 从字典重建魔法定义（base_rank 钳制 1~11）
static func from_dto(serialized_definition: Dictionary) -> MagicDefinition:
	var magic_definition := MagicDefinition.new()
	magic_definition.canonical_id = str(serialized_definition.get("canonical_id", ""))
	magic_definition.magic_form = int(serialized_definition.get("magic_form", DEFAULT_FORM))
	magic_definition.attribute_id = str(serialized_definition.get("attribute_id", ""))
	magic_definition.base_rank = clampi(int(serialized_definition.get("base_rank", RANK_MIN)), RANK_MIN, RANK_MAX)
	magic_definition.effect_profile = str(serialized_definition.get("effect_profile", ""))
	return magic_definition

## 位阶阶位合法域校验（1~11；越界返回 0 显式哨兵，禁静默伪装）
func normalize_rank(rank_value: int) -> int:
	if rank_value >= RANK_MIN and rank_value <= RANK_MAX:
		return rank_value
	return 0
