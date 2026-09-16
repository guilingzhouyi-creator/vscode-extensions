# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/matter_disposal/item_disposal_facility_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/matter_disposal.json | 信号: EventBus 领域广播
# 职责说明: 定义熔炉焚化/便携强酸/熔岩裂隙三大合法处置设施、空间坐标与质量守恒产出比例
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name ItemDisposalFacilityDTO
extends RefCounted

const DEFAULT_MAX_OPERATE_RADIUS: float = 3.0

enum DisposalMethod {
	TOWN_HIGH_HEAT_FURNACE,  # 城镇高温熔炉/焚化炉
	PORTABLE_ACID_SOLVENT,   # 便携式强酸腐蚀溶剂
	ENVIRONMENTAL_LAVA_PIT   # 地质熔岩深渊裂隙
}

var method: DisposalMethod = DisposalMethod.TOWN_HIGH_HEAT_FURNACE
var facility_town_id: String = GameConfig.get_string("domains.world", "node_defaults/town_id", "TOWN_VALAN")
var facility_pos: Vector2 = Vector2.ZERO
var max_operate_radius: float = GameConfig.get_float("domains.matter_disposal", "facility/max_operate_radius", DEFAULT_MAX_OPERATE_RADIUS)

# 产物转换率 (质量守恒: 1.0kg 装备 -> 0.8kg 炉渣 + 0.2kg 尘埃)
var slag_ash_yield_ratio: float = GameConfig.get_float("domains.matter_disposal", "yield_ratio/slag_ash", 0.8)
var mana_dust_yield_ratio: float = GameConfig.get_float("domains.matter_disposal", "yield_ratio/mana_dust", 0.2)

## 处置设施 DTO 构造（方法/坐标/操作半径）
func _init(
	p_method: DisposalMethod = DisposalMethod.TOWN_HIGH_HEAT_FURNACE,
	p_pos: Vector2 = Vector2.ZERO,
	p_radius: float = DEFAULT_MAX_OPERATE_RADIUS
) -> void:
	method = p_method
	facility_pos = p_pos
	max_operate_radius = p_radius
