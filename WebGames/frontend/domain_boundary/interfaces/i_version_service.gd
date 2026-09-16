# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 版本与灰度更新契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_version_service.gd
# 职责: 规范客户端版本握手与热更新检测，对齐 P74 灰度体系
# ==============================================================================
class_name IVersionService
extends RefCounted

## 异步检查客户端版本与灰度分群状态
func check_version_async(callback: Callable) -> void:
	printerr("IVersionService.check_version_async: 纯虚函数必须由子类实现")
