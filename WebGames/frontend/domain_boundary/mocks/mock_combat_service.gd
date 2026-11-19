# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_combat_service.gd
# 架构定位: Domain Boundary Mock / Simulated Combat Service
# 依赖与触发: 上游: MockServiceContainer, 战斗视图 | 下游: MockBaseService, MockDataCatalog
# 职责说明: 提供模拟战斗快照拉取与确定性 LCG 技能伤害演算服务，经 MockBaseService 模拟延迟。
# 退出语义与设计依据: 确定性本地技能演算与网络往返延迟模拟契约
# ==============================================================================

## MockCombatService：战斗快照与技能施放模拟服务
class_name MockCombatService
extends ICombatService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_milliseconds: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_milliseconds

## 模拟异步拉取当前战斗（首领血量、部位耐久与玩家状态）快照
func get_combat_snapshot_async(_battle_id: String, result_callback: Callable) -> void:
	var combat_payload := MockDataCatalog.get_domain_data("combat").duplicate(true)
	combat_payload["success"] = true
	MockBaseService.delayed_call(result_callback, combat_payload, simulate_delay_ms)

var _action_seed: int = 123456789

## 模拟异步技能释放，使用确定性 LCG 高位截断计算暴击与伤害数值
func cast_skill_async(skill_id: String, target_id: String, result_callback: Callable, _skill_parameters: Dictionary = {}) -> void:
	_action_seed = (_action_seed * 1103515245 + 12345) & 0x7FFFFFFF
	# 高位取模：LCG 低位模式随机性差，取中高 16 位截断换算
	var critical_roll_ratio: float = float((_action_seed >> 8) % 1000) / 1000.0
	var is_critical: bool = (critical_roll_ratio > 0.7)
	var damage: float = (80.0 + critical_roll_ratio * 160.0) * (1.5 if is_critical else 1.0)
	MockBaseService.delayed_call(result_callback, {
		"success": true,
		"skill_id": skill_id,
		"actual_damage": damage,
		"is_crit": is_critical,
		"target_id": target_id
	}, simulate_delay_ms)
