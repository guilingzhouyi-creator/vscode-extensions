# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 魔典著书服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_grimoire_service.gd
# 职责: 规范著书估价与版税汇总接口，隔离底层收入公式
# ==============================================================================
class_name IGrimoireService
extends RefCounted

## 著书估价（按稿酬模式返回区间）：{success, min, max}
func estimate_authoring_income(royalty_mode_index: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGrimoireService.estimate_authoring_income: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 版税汇总：{success, total}
func sum_royalties(books: Array) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGrimoireService.sum_royalties: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
