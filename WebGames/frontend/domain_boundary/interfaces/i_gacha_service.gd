# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 抽卡祈愿服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_gacha_service.gd
# 职责: 规范抽卡规则查询、掉落结算与扣费接口，隔离底层概率/保底实现
# ==============================================================================
class_name IGachaService
extends RefCounted

## 获取抽卡规则（概率 / 保底阈值 / 消耗），供视图只读展示
func get_rules() -> Dictionary:
	printerr("IGachaService.get_rules: 纯虚函数必须由子类实现")
	return {}

## 生成掉落（规则与随机均在服务层，视图不感知概率实现）
func generate_drops(count: int, pity_5star: int, pity_4star: int) -> Array:
	printerr("IGachaService.generate_drops: 纯虚函数必须由子类实现")
	return []

## 结算一次抽卡：state 携带保底与统计，injected_drops 供测试注入；返回新状态与结果
func resolve_pull(state: Dictionary, pull_count: int, injected_drops: Array = []) -> Dictionary:
	printerr("IGachaService.resolve_pull: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 购买抽卡次数：校验余额并返回扣费后余额（Result 包装契约）
func purchase(currency: int, pull_count: int) -> Dictionary:
	printerr("IGachaService.purchase: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED", "balance": currency}
