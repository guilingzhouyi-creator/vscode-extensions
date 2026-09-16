# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Core Engine)
# 文件路径: res://backend/infrastructure/fifo_budget.gd
# 架构定位: Infrastructure Service
# 跨域依赖: 上游: 全域业务域 (Domains) | 下游: GameConfig, EventBusCore | 配置: config/infrastructure/*.json | 信号: 无直接信号 (由子系统广播)
# 职责说明: 幂等台账/审计容器超容裁剪的统一实现——单次 keys 快照后按插入序 擦除最旧溢出项（Dictionary 保持插入序），消除既有「while…erase(keys()[0])」 每轮整表重建 keys 数组的 O(k×N) 反模式（Phase 44 P4）。
# 设计依据: WebGames 基础设施分层架构规范
# ==============================================================================

class_name FifoBudget
extends RefCounted

## 最旧先出裁剪：容器尺寸 > max_entries 时擦除最旧溢出项，返回擦除数。
## max_entries < 0 视为无界（零操作，兼容「不裁剪」语义）；未溢出零操作零分配。
## 语义与既有 while keys()[0] 逐轮擦除逐位一致（两次实现均按 Dictionary 插入序取最旧）。
static func trim_oldest(container: Dictionary, max_entries: int) -> int:
	if max_entries < 0:
		return 0
	var over: int = container.size() - max_entries
	if over <= 0:
		return 0
	var keys := container.keys()
	for i in range(over):
		container.erase(keys[i])
	return over
