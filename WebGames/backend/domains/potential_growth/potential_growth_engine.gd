# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/potential_growth/potential_growth_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/potential.json | 信号: EventBus 领域广播
# 职责说明: 潜能点存储、阅历突破（卡拉尔替代「升级」）获取潜能点契约 文案由 config/narratives/potential.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name PotentialGrowthEngine extends RefCounted

var unassigned_potential_points: int = 0
var lifetime_potential_earned: int = 0
var allocated_points_history: Dictionary = {
	"STR": 0, "CON": 0, "INT": 0, "AGI": 0, "SPR": 0, "VIT": 0
}

## 潜能点发放：负值归零 + 终生累计 + 阅历突破文案广播
func grant_potential_points(points: int, reason: String = "") -> int:
	var safe_points = max(0, points)
	unassigned_potential_points += safe_points
	lifetime_potential_earned += safe_points

	var r := reason if not reason.is_empty() else GameConfig.get_string("domains.potential", "growth/default_reason", "ENLIGHTENMENT")
	EventBusCore.get_instance().emit_narrative_by_key(
		"potential/grant_points", "lifecycle", [r, safe_points, unassigned_potential_points]
	)
	return unassigned_potential_points

## 序列化潜能引擎状态为字典
func serialize() -> Dictionary:
	return {
		"unassigned_potential_points": unassigned_potential_points,
		"lifetime_potential_earned": lifetime_potential_earned,
		"allocated_points_history": allocated_points_history
	}

## 从字典重建：M9 收敛——lifetime 非负先行，unassigned 夹紧于 [0, lifetime]（Inv-TX-3 序关系）
static func deserialize(d: Dictionary) -> PotentialGrowthEngine:
	var eng := PotentialGrowthEngine.new()
	# M9 收敛：先收敛 lifetime 非负，再夹紧 unassigned ∈ [0, lifetime]（Inv-TX-3 序关系），
	# 损坏/篡改存档不得让「未分配 > 终生获得」进入洗点成本计算（负成本=反向增发）
	eng.lifetime_potential_earned = maxi(0, int(d.get("lifetime_potential_earned", 0)))
	eng.unassigned_potential_points = clampi(int(d.get("unassigned_potential_points", 0)), 0, eng.lifetime_potential_earned)
	eng.allocated_points_history = d.get("allocated_points_history", {})
	return eng
