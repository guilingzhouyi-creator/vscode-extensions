# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 骨架快照数据服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_snapshot_data_service.gd
# 职责: 委托 MockDataCatalog 唯一数据源并按域返回深拷贝快照 (Phase 83 R-01 收敛)
# 边界: 快照数据唯一物化于 MockDataCatalog，演示骨架已退役删除
# ==============================================================================
class_name MockSnapshotDataService
extends ISnapshotDataService

func load_snapshot(domain_id: String) -> Dictionary:
	# 单一真源：快照数据唯一物化于 MockDataCatalog（R-01 唯一真源收敛）
	var data: Variant = MockDataCatalog.get_domain_data(domain_id)
	if data is Dictionary:
		return (data as Dictionary).duplicate(true)
	if data is Array:
		return {"items": (data as Array).duplicate(true)}
	return {}
