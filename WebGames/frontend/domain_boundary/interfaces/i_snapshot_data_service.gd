# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 骨架快照数据服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_snapshot_data_service.gd
# 职责: 规范前端骨架演示快照的域级读取接口，收敛 mock 真源
# ==============================================================================
class_name ISnapshotDataService
extends RefCounted

## 读取指定域的骨架 Mock 快照（文件缺失/解析失败返回空字典）
func load_snapshot(domain_id: String) -> Dictionary:
	printerr("ISnapshotDataService.load_snapshot: 纯虚函数必须由子类实现")
	return {}
