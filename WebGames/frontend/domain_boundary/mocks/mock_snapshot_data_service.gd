# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_snapshot_data_service.gd
# 架构定位: Domain Boundary Mock / Snapshot Catalog Reader
# 依赖与触发: 上游: MockServiceContainer, 前端视图测试 | 下游: MockDataCatalog
# 职责说明: 委托 MockDataCatalog 唯一模拟数据源并按域返回深拷贝只读快照。
# 退出语义与设计依据: 模拟快照单一真源收敛与深拷贝防外部篡改契约
# ==============================================================================

## MockSnapshotDataService：域级模拟快照只读加载服务
class_name MockSnapshotDataService
extends ISnapshotDataService

## 从 MockDataCatalog 单一模拟数据源加载指定域快照并返回深拷贝副本
func load_snapshot(domain_id: String) -> Dictionary:
	# 模拟快照数据单一集中物化于 MockDataCatalog，避免跨文件重复硬编码样本
	var domain_payload: Variant = MockDataCatalog.get_domain_data(domain_id)
	if domain_payload is Dictionary:
		return (domain_payload as Dictionary).duplicate(true)
	if domain_payload is Array:
		return {"items": (domain_payload as Array).duplicate(true)}
	return {}
