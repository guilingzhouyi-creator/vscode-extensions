# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟战斗服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_combat_service.gd
# 职责: 模拟战斗快照获取与技能伤害结算（确定性 LCG 高位取模），经 MockBaseService 模拟网络延迟
# ==============================================================================
class_name MockCombatService
extends ICombatService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

func get_combat_snapshot_async(battle_id: String, callback: Callable) -> void:
	var combat_data := MockDataCatalog.get_domain_data("combat")
	MockBaseService.delayed_call(callback, { "success": true, "combat": combat_data.duplicate(true) }, simulate_delay_ms)

var _action_seed: int = 123456789

func cast_skill_async(skill_id: String, target_id: String, callback: Callable) -> void:
	_action_seed = (_action_seed * 1103515245 + 12345) & 0x7FFFFFFF
	# 高位取模：LCG 低位模式随机性差，取中高 16 位截断换算
	var ratio: float = float((_action_seed >> 8) % 1000) / 1000.0
	var is_crit: bool = (ratio > 0.7)
	var dmg: float = (80.0 + ratio * 160.0) * (1.5 if is_crit else 1.0)
	MockBaseService.delayed_call(callback, {
		"success": true,
		"skill_id": skill_id,
		"damage": dmg,
		"is_crit": is_crit,
		"target_id": target_id
	}, simulate_delay_ms)