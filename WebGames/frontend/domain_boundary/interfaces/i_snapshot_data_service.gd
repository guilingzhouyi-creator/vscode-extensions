# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_snapshot_data_service.gd
# 架构定位: Domain Boundary Interface / Snapshot Data Reader Contract
# 依赖与触发: 上游: 视图快照加载器, ServiceContainer | 下游: MockSnapshotDataService
# 职责说明: 规范前端只读演示快照的域级加载接口，将模拟快照读取集中收敛至领域边界层。
# 退出语义与设计依据: 视图层禁止直读模拟快照文件契约
# ==============================================================================

## ISnapshotDataService：前端域级模拟快照读取服务抽象接口
class_name ISnapshotDataService
extends RefCounted

## 读取指定域的骨架 Mock 快照（文件缺失/解析失败返回空字典）
func load_snapshot(domain_id: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ISnapshotDataService.load_snapshot: pure virtual method must be implemented by subclass")
	return {}
