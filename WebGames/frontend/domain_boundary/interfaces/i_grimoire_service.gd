# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_grimoire_service.gd
# 架构定位: Domain Boundary Interface / Grimoire Authoring Service Contract
# 依赖与触发: 上游: 魔典著书与手稿市场视图, ServiceContainer | 下游: MockGrimoireService
# 职责说明: 规范魔典著书估价区间与版税汇总接口，隔离底层稿酬与版税收益公式。
# 退出语义与设计依据: 表现层零收益公式计算与领域边界解耦契约
# ==============================================================================

## IGrimoireService：魔典著书估价与版税结算服务抽象接口
class_name IGrimoireService
extends RefCounted

## 著书估价（按稿酬模式返回区间）：{success, min, max}
func estimate_authoring_income(_royalty_mode_index: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGrimoireService.estimate_authoring_income: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 版税汇总：{success, total}
func sum_royalties(_books: Array) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IGrimoireService.sum_royalties: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 分发魔典编纂、编译与版税领取动作（默认兼容回执）
func dispatch_grimoire_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
