# ==============================================================================
# 单元测试：Phase 69 有界缓存与幂等性控制 (Bounded Cache & Idempotency)
# 文件路径: res://tests/unit/infrastructure/test_bounded_cache_and_idempotency.gd
# 职责: 验证有界LRU/FIFO/TTL淘汰、热重载清理与幂等防重控制器（TC-RM-11 ~ TC-RM-20）
# ==============================================================================
class_name TestBoundedCacheAndIdempotency extends RefCounted

const CachePolicySpec = preload("res://backend/infrastructure/resource_governance/cache_policy_spec.gd")
const BoundedResourceCache = preload("res://backend/infrastructure/resource_governance/bounded_resource_cache.gd")
const IdempotencyController = preload("res://backend/infrastructure/robustness/idempotency_controller.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_basic_cache_ops())
	results.append(test_lru_capacity_eviction())
	results.append(test_lru_hot_access_eviction())
	results.append(test_ttl_expiration())
	results.append(test_hot_reload_clear_enabled())
	results.append(test_hot_reload_clear_disabled())
	results.append(test_idempotency_first_run())
	results.append(test_idempotency_duplicate_intercept())
	results.append(test_idempotency_empty_token())
	results.append(test_idempotency_history_limit())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "Phase 69: 有界缓存与幂等性控制",
		"all_passed": all_passed,
		"results": results
	}

## TC-RM-11: 缓存基础读写与默认回退
static func test_basic_cache_ops() -> Dictionary:
	var cache := BoundedResourceCache.new()
	cache.put("k1", "v1")
	var v1: Variant = cache.get_val("k1")
	var v_missing: Variant = cache.get_val("missing_key", "default_val")
	
	var passed: bool = (str(v1) == "v1") and (str(v_missing) == "default_val") and cache.has("k1") and (not cache.has("missing_key"))
	return {
		"test": "TC-RM-11: 缓存基础读写与缺失键安全回退",
		"passed": passed,
		"detail": "v1=%s, v_missing=%s" % [v1, v_missing]
	}

## TC-RM-12: LRU 容量上限硬约束淘汰
static func test_lru_capacity_eviction() -> Dictionary:
	var spec := CachePolicySpec.new("cap_test", 3, CachePolicySpec.EvictionPolicy.LRU)
	var cache := BoundedResourceCache.new(spec)
	cache.put("a", 1)
	cache.put("b", 2)
	cache.put("c", 3)
	cache.put("d", 4) # 应淘汰 a
	
	var passed: bool = (cache.size() == 3) and (not cache.has("a")) and cache.has("b") and cache.has("c") and cache.has("d")
	return {
		"test": "TC-RM-12: LRU 容量硬约束与超额条目精准驱逐",
		"passed": passed,
		"detail": "size=%d, has_a=%s, has_d=%s" % [cache.size(), cache.has("a"), cache.has("d")]
	}

## TC-RM-13: LRU 热点访问更新命中
static func test_lru_hot_access_eviction() -> Dictionary:
	var spec := CachePolicySpec.new("lru_hot", 3, CachePolicySpec.EvictionPolicy.LRU)
	var cache := BoundedResourceCache.new(spec)
	cache.put("a", 1)
	cache.put("b", 2)
	cache.put("c", 3)
	
	# 访问 a，使其成为最近使用的热点
	cache.get_val("a")
	cache.put("d", 4) # 此时最久未使用的应当是 b，淘汰 b
	
	var passed: bool = (cache.size() == 3) and cache.has("a") and (not cache.has("b")) and cache.has("c") and cache.has("d")
	return {
		"test": "TC-RM-13: LRU 热点访问延寿与最久未访问精准淘汰",
		"passed": passed,
		"detail": "has_a=%s, has_b=%s, has_c=%s, has_d=%s" % [cache.has("a"), cache.has("b"), cache.has("c"), cache.has("d")]
	}

## TC-RM-14: TTL 超时自动失效与淘汰
static func test_ttl_expiration() -> Dictionary:
	var spec := CachePolicySpec.new("ttl_test", 10, CachePolicySpec.EvictionPolicy.TTL, 0.05)
	var cache := BoundedResourceCache.new(spec)
	cache.put("exp_key", "active")
	
	var v_before: Variant = cache.get_val("exp_key")
	OS.delay_msec(70) # 等待 70ms，超出 50ms TTL
	var v_after: Variant = cache.get_val("exp_key", "expired")
	
	var passed: bool = (str(v_before) == "active") and (str(v_after) == "expired") and (not cache.has("exp_key"))
	return {
		"test": "TC-RM-14: TTL 生存时间过期检测与自动安全剔除",
		"passed": passed,
		"detail": "v_before=%s, v_after=%s" % [v_before, v_after]
	}

## TC-RM-15: 热重载清理通道生效验证
static func test_hot_reload_clear_enabled() -> Dictionary:
	var spec := CachePolicySpec.new("hr_enabled", 10, CachePolicySpec.EvictionPolicy.LRU, 300.0, true)
	var cache := BoundedResourceCache.new(spec)
	cache.put("temp1", "val1")
	cache.put("temp2", "val2")
	
	cache.clear_on_hot_reload()
	var passed: bool = (cache.size() == 0) and (not cache.has("temp1"))
	return {
		"test": "TC-RM-15: 允许热重载刷新时全量清空缓存通道",
		"passed": passed,
		"detail": "size_after_clear=%d" % cache.size()
	}

## TC-RM-16: 热重载保护通道禁用验证
static func test_hot_reload_clear_disabled() -> Dictionary:
	var spec := CachePolicySpec.new("hr_disabled", 10, CachePolicySpec.EvictionPolicy.LRU, 300.0, false)
	var cache := BoundedResourceCache.new(spec)
	cache.put("persistent1", "val1")
	
	cache.clear_on_hot_reload()
	var passed: bool = (cache.size() == 1) and cache.has("persistent1")
	return {
		"test": "TC-RM-16: 禁用热重载刷新时缓存数据安全保持",
		"passed": passed,
		"detail": "size_after_trigger=%d" % cache.size()
	}

## TC-RM-17: 幂等控制器首次执行记录
static func test_idempotency_first_run() -> Dictionary:
	var controller := IdempotencyController.new()
	var res: Dictionary = controller.check_and_record("SAVE_OP_001", {"status": "saved", "bytes": 1024})
	
	var passed: bool = (not bool(res.get("already_executed", true))) and controller.has_token("SAVE_OP_001")
	return {
		"test": "TC-RM-17: 幂等控制器首次执行正常放行与记录",
		"passed": passed,
		"detail": "already_executed=%s" % res.get("already_executed", null)
	}

## TC-RM-18: 幂等控制器二次重复拦截
static func test_idempotency_duplicate_intercept() -> Dictionary:
	var controller := IdempotencyController.new()
	var payload: Dictionary = {"reward_id": 999, "amount": 100}
	var res1: Dictionary = controller.check_and_record("REWARD_TX_002", payload)
	var res2: Dictionary = controller.check_and_record("REWARD_TX_002", {"reward_id": 999, "amount": 9999}) # 重复传入不同值，应透传首次值
	
	var r2_data: Dictionary = res2.get("result", {})
	var passed: bool = (not bool(res1.get("already_executed", true))) and bool(res2.get("already_executed", false)) and (int(r2_data.get("amount", 0)) == 100)
	return {
		"test": "TC-RM-18: 幂等控制器重复调用拦截并透传初始结果",
		"passed": passed,
		"detail": "r1_executed=%s, r2_executed=%s, r2_amount=%d" % [res1.get("already_executed", null), res2.get("already_executed", null), int(r2_data.get("amount", 0))]
	}

## TC-RM-19: 幂等控制器空 Token 安全防护
static func test_idempotency_empty_token() -> Dictionary:
	var controller := IdempotencyController.new()
	var res: Dictionary = controller.check_and_record("")
	
	var passed: bool = (not bool(res.get("already_executed", true))) and (controller.history_size() == 0)
	return {
		"test": "TC-RM-19: 幂等控制器空 Token 安全防护与零记录",
		"passed": passed,
		"detail": "already_executed=%s, history=%d" % [res.get("already_executed", null), controller.history_size()]
	}

## TC-RM-20: 幂等控制器历史记录容量上限
static func test_idempotency_history_limit() -> Dictionary:
	var controller := IdempotencyController.new(15) # 上限 15 条
	for i in range(25):
		controller.check_and_record("TX_TOKEN_%d" % i, i)
	
	var size_ok: bool = (controller.history_size() <= 15)
	var old_token_evicted: bool = (not controller.has_token("TX_TOKEN_0"))
	var new_token_kept: bool = controller.has_token("TX_TOKEN_24")
	
	var passed: bool = size_ok and old_token_evicted and new_token_kept
	return {
		"test": "TC-RM-20: 幂等控制器历史记录容量有界约束与旧令牌滚动淘汰",
		"passed": passed,
		"detail": "history_size=%d, has_0=%s, has_24=%s" % [controller.history_size(), controller.has_token("TX_TOKEN_0"), controller.has_token("TX_TOKEN_24")]
	}
