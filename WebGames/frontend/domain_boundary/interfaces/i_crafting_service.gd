# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 制造工坊服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_crafting_service.gd
# 职责: 规范强化成功率预测与分解产出接口，隔离底层公式与配置读取
# ==============================================================================
class_name ICraftingService
extends RefCounted

## 预测强化成功率（返回 {success, rate}）；衰减公式与钳制在服务层
func preview_enhance_rate(target_level: int) -> Dictionary:
	printerr("ICraftingService.preview_enhance_rate: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}
