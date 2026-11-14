# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Contracts)
# 文件路径: res://frontend/domain_boundary/contracts/combat_floating_text_dto.gd
# 架构定位: Presentation Floating Text Data Transfer Object
# 依赖与触发: 上游: 战斗表现层视图 | 下游: 战斗浮字子面板
# 职责说明: 在战斗视图与子面板之间传递强类型浮字渲染数据，不承载业务规则或副作用。
# 退出语义与设计依据: 前端强类型快照 DTO 隔离与纯展示零业务计算契约
# ==============================================================================

## CombatFloatingTextDTO：战斗伤害与治疗浮字渲染数据契约
class_name CombatFloatingTextDTO
extends RefCounted

var text_id: int
var amount: float
var is_crit: bool
var is_heal: bool
var world_pos: Vector2
var lifetime: float = 1.0
