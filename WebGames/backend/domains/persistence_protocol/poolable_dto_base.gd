# ==============================================================================
# 模块归属: 业务领域层 (Domains · 持久化协议与共享契约 (Persistence Protocol))
# 文件路径: res://backend/domains/persistence_protocol/poolable_dto_base.gd
# 架构定位: Domain Value Object Base / Zero-Heap-Allocation Poolable DTO Contract
# 依赖与触发: 上游: 全域领域 DTO 与对象池容器 | 下游: RefCounted | 配置: 无直读 | 信号: 无
# 职责说明: 为全域领域 DTO 提供统一的状态重置与零堆分配复用领域内基类契约，遵循清洁架构内部依赖方向（严禁 Domain 反向依赖 Infrastructure）。
# 退出语义与设计依据: 清洁架构分层依赖守则与对象池复用基类契约 (GDM-POOL-002)
# ==============================================================================

## PoolableDtoBase：全域领域可池化 DTO 统一领域内基类契约
class_name PoolableDtoBase
extends RefCounted

var _is_pool_active: bool = true
var _pool_generation: int = 0
var _pool_reuse_count: int = 0

## 重置内部数据状态（派生类重写时必须显式调用 super.reset_state()）
func reset_state() -> void:
	_pool_generation += 1

## 标记对象从对象池租出，进入活跃使用态并递增复用计数
func mark_pooled_acquire() -> void:
	_is_pool_active = true
	_pool_reuse_count += 1

## 标记对象归还对象池并执行状态重置，避免重复归还
func mark_pooled_release() -> void:
	if not _is_pool_active:
		return
	_is_pool_active = false
	reset_state()

## 返回当前实例是否处于对象池活跃租出状态
func is_pool_active() -> bool:
	return _is_pool_active

## 返回当前实例经历的重置代数（用于检测过期句柄复用）
func get_pool_generation() -> int:
	return _pool_generation

## 返回当前实例累计被对象池复用的次数
func get_pool_reuse_count() -> int:
	return _pool_reuse_count
