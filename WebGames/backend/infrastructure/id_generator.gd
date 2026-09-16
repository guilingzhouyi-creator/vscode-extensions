# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Identity Provider)
# 文件路径: res://backend/infrastructure/id_generator.gd
# 架构定位: Snowflake-Style UUID Generator
# 跨域依赖: 上游: ItemLoaderPipeline, CombatCore, NetworkAdapter | 下游: WorldClockMaster | 配置: config/infrastructure/id.json | 信号: 无
# 职责说明: 消灭「前缀 + 毫秒时间戳」自造 ID 在同一毫秒内的碰撞隐患。 同一毫秒内首次生成保持旧格式 "<prefix><毫秒>"；第二次起追加自增序号 后缀 "_<n>"。既有存档与测试对单发 ID 形态的预期不受影响。  用法: var id := UniqueIdGenerator.next_id(item_id_prefix)   # 例: GM_ITEM_172... 不适用场景: 以时间戳作为哈希签名因子（gm_audit / token）——签名输入变化会 改变既有签名值，此类调用继续手写 str(Time.get_ticks_msec())。
# 设计依据: Phase 10 全局实体唯一标识规范
# ==============================================================================

class_name UniqueIdGenerator extends RefCounted

# ==============================================================================
# 一、状态
# ==============================================================================

static var _last_tick_msec: int = -1  # 上一次生成的时间戳（毫秒，同毫秒碰撞检测基准）
static var _same_tick_count: int = 0  # 同毫秒内已生成次数（追加序号来源）

# ==============================================================================
# 二、核心生成算法
# ==============================================================================

## 生成 "<prefix><毫秒时间戳>"；同毫秒重复调用时追加 "_<序号>" 保证进程内唯一
static func next_id(prefix: String) -> String:
	var tick := Time.get_ticks_msec()
	if tick == _last_tick_msec:
		_same_tick_count += 1
	else:
		_last_tick_msec = tick
		_same_tick_count = 0
	var suffix := str(tick) if _same_tick_count == 0 else str(tick) + "_" + str(_same_tick_count)
	return prefix + suffix
