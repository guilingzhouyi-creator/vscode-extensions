# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_gacha_service.gd
# 架构定位: Domain Boundary Interface / Gacha Wish Service Contract
# 依赖与触发: 上游: 抽卡祈愿视图, ServiceContainer | 下游: MockGachaService
# 职责说明: 规范抽卡规则查询、保底掉落结算与次数购买扣费接口，隔离底层概率与保底实现。
# 退出语义与设计依据: 表现层零抽卡概率计算与领域边界解耦契约
# ==============================================================================

## IGachaService：抽卡祈愿规则与保底结算服务抽象接口
class_name IGachaService
extends RefCounted

## 获取抽卡规则（概率 / 保底阈值 / 消耗），供视图只读展示
func get_rules() -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGachaService.get_rules: pure virtual method must be implemented by subclass")
	return {}

## 生成掉落（规则与随机均在服务层，视图不感知概率实现）
func generate_drops(count: int, pity_5star: int, pity_4star: int) -> Array:
	EventBusCore.get_instance().emit_log("error", "IGachaService.generate_drops: pure virtual method must be implemented by subclass")
	return []

## 结算一次抽卡：state 携带保底与统计，injected_drops 供测试注入；返回新状态与结果
func resolve_pull(state: Dictionary, pull_count: int, injected_drops: Array = []) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGachaService.resolve_pull: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 购买抽卡次数：校验余额并返回扣费后余额（Result 包装契约）
func purchase(currency: int, pull_count: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGachaService.purchase: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED", "balance": currency}
