# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/dynamic_pack_mount_manager.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 基于 Godot 4.7 原生虚拟文件系统 (VFS) 实现增量 PCK 物理覆盖挂载与版本堆栈管理
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name DynamicPackMountManager
extends RefCounted

## 记录当前已成功挂载的补丁包堆栈 (按 priority 升序重排，末位为最高优先级)
static var _mounted_packs: Array[Dictionary] = []

## 动态挂载增量 PCK 资源包 (覆盖式物理挂载)
static func mount_patch_pack(pck_path: String, version_str: String, priority: int = 100) -> bool:
	if not FileAccess.file_exists(pck_path):
		EventBusCore.get_instance().emit_log("error", "【PackMount】挂载失败：补丁文件不存在 -> %s" % pck_path)
		return false

	# 利用 Godot 原生虚拟文件系统，replace_files = true 执行覆盖式挂载
	var success := ProjectSettings.load_resource_pack(pck_path, true)
	if not success:
		EventBusCore.get_instance().emit_log("error", "【PackMount】Godot 原生 load_resource_pack 失败 -> %s" % pck_path)
		return false

	_mounted_packs.append({
		"path": pck_path,
		"version": version_str,
		"priority": priority
	})
	# 按优先级升序重排，确保高优先级覆盖低优先级
	_mounted_packs.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a.get("priority", 0)) < int(b.get("priority", 0))
	)
	return true

## 获取当前活跃的最高挂载版本
static func get_active_mounted_version() -> String:
	if _mounted_packs.is_empty():
		return "1.0.0" # 基础原始版本
	return String(_mounted_packs[-1].get("version", "1.0.0"))

## 获取当前已挂载的所有补丁包清单只读快照
static func get_mounted_packs() -> Array[Dictionary]:
	return _mounted_packs.duplicate(true)

## 重置清空挂载记录 (供单元测试或深度回滚使用)
static func reset_for_tests() -> void:
	_mounted_packs.clear()
