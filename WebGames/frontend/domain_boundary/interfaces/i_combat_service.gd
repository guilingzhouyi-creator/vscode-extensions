# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_combat_service.gd
# 架构定位: Domain Boundary Interface / Combat Service Contract
# 依赖与触发: 上游: CombatViewModel, 战斗视图, ServiceContainer | 下游: MockCombatService
# 职责说明: 规范战斗快照拉取与技能交互动作接口，隔离底层 CombatPipelineFSM 与战斗结算实现。
# 退出语义与设计依据: 表现层零战斗计算与领域边界解耦契约
# ==============================================================================

## ICombatService：战斗快照与技能施放服务抽象接口
class_name ICombatService
extends RefCounted

## 获取当前战斗快照 (BOSS血条、多部位状态、玩家状态)
func get_combat_snapshot_async(battle_id: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICombatService.get_combat_snapshot_async: pure virtual method must be implemented by subclass")

## 释放技能动作模拟
func cast_skill_async(skill_id: String, target_id: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "ICombatService.cast_skill_async: pure virtual method must be implemented by subclass")
