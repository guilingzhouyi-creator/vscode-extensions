# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 战斗表现层浮字数据契约
# 文件路径: res://frontend/domain_boundary/contracts/combat_floating_text_dto.gd
# 职责: 在战斗视图与子面板之间传递强类型浮字渲染数据
# 边界: 纯表现数据，不承载业务规则或副作用
# ==============================================================================
class_name CombatFloatingTextDTO
extends RefCounted

var text_id: int
var amount: float
var is_crit: bool
var is_heal: bool
var world_pos: Vector2
var lifetime: float = 1.0