# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 战斗服务抽象契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_combat_service.gd
# 职责: 规范战斗快照拉取与技能交互动作接口，隔离底层 CombatPipelineFSM
# ==============================================================================
class_name ICombatService
extends RefCounted

## 获取当前战斗快照 (BOSS血条、多部位状态、玩家状态)
func get_combat_snapshot_async(battle_id: String, callback: Callable) -> void:
	printerr("ICombatService.get_combat_snapshot_async: 纯虚函数必须由子类实现")

## 释放技能动作模拟
func cast_skill_async(skill_id: String, target_id: String, callback: Callable) -> void:
	printerr("ICombatService.cast_skill_async: 纯虚函数必须由子类实现")
