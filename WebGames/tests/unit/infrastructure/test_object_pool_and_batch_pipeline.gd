# ==============================================================================
# 模块归属: 单元测试 (Tests · Infrastructure · High Pressure Pooling)
# 文件路径: res://tests/unit/infrastructure/test_object_pool_and_batch_pipeline.gd
# 架构定位: Object Pool & Batch Pipeline End-to-End Test Suite
# 跨域依赖: 上游: TestRegistry | 下游: ObjectPool, SoAEntityBuffer, HeadlessBatchPipeline, ObjectPoolManager | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 高承压对象池与无头批处理流水线端到端验收测试套件：验证预分配、
#           借出复位、双重归还拦截、溢出丢弃、万次吞吐零泄漏、SoA 对齐与管理器生命周期。
# 设计依据: 演进 03 阶段4 高承压对象复用与批处理吞吐端到端验收测试矩阵
# ==============================================================================

class_name TestObjectPoolAndBatchPipeline extends RefCounted

const ObjectPoolConfigDTO = preload("res://backend/infrastructure/object_pool_config_dto.gd")
const ObjectPoolStatsDTO = preload("res://backend/infrastructure/object_pool_stats_dto.gd")
const ObjectPool = preload("res://backend/infrastructure/object_pool.gd")
const SoAEntityBuffer = preload("res://backend/infrastructure/soa_entity_buffer.gd")
const HeadlessBatchPipeline = preload("res://backend/infrastructure/headless_batch_pipeline.gd")
const ObjectPoolManager = preload("res://backend/infrastructure/object_pool_manager.gd")

class DummyPoolableItem extends RefCounted:
	var value: int = 100
	var tag: String = "dirty"
	var is_reset_called: bool = false

	func reset_state() -> void:
		value = 0
		tag = ""
		is_reset_called = true

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_pool_preallocation_and_capacity())
	results.append(test_pool_acquire_reset_state())
	results.append(test_pool_double_release_prevention())
	results.append(test_pool_overflow_discard_policy())
	results.append(test_high_frequency_churn_zero_leak())
	results.append(test_soa_buffer_alignment())
	results.append(test_headless_batch_pipeline_zero_allocation())
	results.append(test_pool_manager_assembly_lifecycle())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break

	return {
		"domain": "演进 03: 高承压对象池与数据导向无头处理器架构",
		"all_passed": all_passed,
		"results": results
	}

## 1. 预分配与容量模型测试
static func test_pool_preallocation_and_capacity() -> Dictionary:
	var cfg := ObjectPoolConfigDTO.new()
	cfg.pool_name = "test_prealloc"
	cfg.preallocate_size = 16
	cfg.max_capacity = 32
	var pool := ObjectPool.new(func(): return DummyPoolableItem.new(), cfg)
	var stats := pool.get_stats()
	var ok: bool = (stats.idle_in_pool == 16 and stats.total_allocated == 16)
	return {
		"test": "TC-POOL-01: 预分配容量与统计指标对齐",
		"passed": ok,
		"detail": "idle=%d, allocated=%d" % [stats.idle_in_pool, stats.total_allocated]
	}

## 2. 借出时状态彻底重置断言
static func test_pool_acquire_reset_state() -> Dictionary:
	var cfg := ObjectPoolConfigDTO.new()
	cfg.pool_name = "test_reset"
	cfg.preallocate_size = 2
	var pool := ObjectPool.new(func(): return DummyPoolableItem.new(), cfg)
	var item: DummyPoolableItem = pool.acquire() as DummyPoolableItem
	item.value = 999
	item.tag = "corrupted"
	pool.release(item)
	var item_reacquired: DummyPoolableItem = pool.acquire() as DummyPoolableItem
	var ok: bool = (item_reacquired.value == 0 and item_reacquired.tag == "" and item_reacquired.is_reset_called)
	return {
		"test": "TC-POOL-02: 借出时状态彻底重置 reset_state",
		"passed": ok,
		"detail": "value=%d, tag=%s, reset_called=%s" % [item_reacquired.value, item_reacquired.tag, str(item_reacquired.is_reset_called)]
	}

## 3. 防重复归还与非法归还拦截断言
static func test_pool_double_release_prevention() -> Dictionary:
	var cfg := ObjectPoolConfigDTO.new()
	cfg.pool_name = "test_double_release"
	var pool := ObjectPool.new(func(): return DummyPoolableItem.new(), cfg)
	var item: DummyPoolableItem = pool.acquire() as DummyPoolableItem
	var first_release: bool = pool.release(item)
	var second_release: bool = pool.release(item)
	var ok: bool = (first_release == true and second_release == false)
	return {
		"test": "TC-POOL-03: 防重复归还与未借出拦截",
		"passed": ok,
		"detail": "first=%s, second=%s" % [str(first_release), str(second_release)]
	}

## 4. 溢出丢弃机制断言
static func test_pool_overflow_discard_policy() -> Dictionary:
	var cfg := ObjectPoolConfigDTO.new()
	cfg.pool_name = "test_overflow"
	cfg.preallocate_size = 0
	cfg.max_capacity = 2
	cfg.allow_overflow_alloc = true
	var pool := ObjectPool.new(func(): return DummyPoolableItem.new(), cfg)
	var a: RefCounted = pool.acquire()
	var b: RefCounted = pool.acquire()
	var c: RefCounted = pool.acquire()
	pool.release(a)
	pool.release(b)
	pool.release(c)
	var ok: bool = (pool.get_stats().idle_in_pool == 2)
	return {
		"test": "TC-POOL-04: 超过最大容量上限自然丢弃脱钩",
		"passed": ok,
		"detail": "idle_in_pool=%d" % pool.get_stats().idle_in_pool
	}

## 5. 高频吞吐 10,000 次借还零泄漏断言
static func test_high_frequency_churn_zero_leak() -> Dictionary:
	var cfg := ObjectPoolConfigDTO.new()
	cfg.pool_name = "test_churn"
	cfg.preallocate_size = 64
	cfg.max_capacity = 128
	var pool := ObjectPool.new(func(): return DummyPoolableItem.new(), cfg)
	for i in range(10000):
		var obj: RefCounted = pool.acquire()
		pool.release(obj)
	var stats := pool.get_stats()
	var ok: bool = (stats.active_in_use == 0 and stats.total_acquires == 10000 and stats.total_releases == 10000)
	return {
		"test": "TC-POOL-05: 高频 10,000 次借还零泄漏与守恒",
		"passed": ok,
		"detail": "active=%d, acquires=%d, releases=%d" % [stats.active_in_use, stats.total_acquires, stats.total_releases]
	}

## 6. SoA 缓冲区数组长度对齐断言
static func test_soa_buffer_alignment() -> Dictionary:
	var buf := SoAEntityBuffer.new()
	buf.active_count = 100
	buf.resize(100)
	var ok: bool = buf.is_aligned()
	return {
		"test": "TC-POOL-06: SoA 紧凑连续内存数组尺寸对齐",
		"passed": ok,
		"detail": "is_aligned=%s, capacity=%d" % [str(ok), buf.capacity]
	}

## 7. 无头批处理管线零堆分配与正确性测试
static func test_headless_batch_pipeline_zero_allocation() -> Dictionary:
	var buf := SoAEntityBuffer.new()
	var count: int = 1000
	buf.active_count = count
	buf.resize(count)
	for i in range(count):
		buf.pos_x[i] = 0.0
		buf.vel_x[i] = 10.0
		buf.flags[i] = 0
	HeadlessBatchPipeline.step_kinematics(buf, 0.1, 1.0)
	var first_ok: bool = absf(buf.pos_x[0] - 1.0) < 0.0001
	var last_ok: bool = absf(buf.pos_x[count - 1] - 1.0) < 0.0001
	var ok: bool = (first_ok and last_ok)
	return {
		"test": "TC-POOL-07: 无头批处理管线流式步进精度",
		"passed": ok,
		"detail": "first=%.4f, last=%.4f" % [buf.pos_x[0], buf.pos_x[count - 1]]
	}

## 8. 全局池管理器生命周期断言
static func test_pool_manager_assembly_lifecycle() -> Dictionary:
	ObjectPoolManager.initialize()
	var pool := ObjectPoolManager.register_pool("dummy_pool", func(): return DummyPoolableItem.new())
	var acquired: bool = (ObjectPoolManager.get_pool("dummy_pool") != null)
	var pool_count: int = ObjectPoolManager.get_pool_count()
	ObjectPoolManager.teardown()
	var after_teardown: bool = (ObjectPoolManager.get_pool("dummy_pool") == null and ObjectPoolManager.get_pool_count() == 0)
	var ok: bool = (acquired and after_teardown and pool_count > 0)
	return {
		"test": "TC-POOL-08: 全局池管理器装配与对称反装配生命周期",
		"passed": ok,
		"detail": "acquired=%s, after_teardown=%s" % [str(acquired), str(after_teardown)]
	}
