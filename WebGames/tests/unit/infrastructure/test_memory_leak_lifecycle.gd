# ==============================================================================
# 单元测试：内存泄漏生命周期防御与引用解环 (Memory Leak Lifecycle Defense)
# 文件路径: res://tests/unit/infrastructure/test_memory_leak_lifecycle.gd
# 职责: 验证弱引用自环破除、失效 Callable 死亡令牌修剪、WorkerPool FIFO 缓存截断、
#       AuthService 过期会话单向淘汰与 Hook 精确注销（TC-MEM-01 ~ TC-MEM-07）
# ==============================================================================
class_name TestMemoryLeakLifecycle extends RefCounted


static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_event_bus_token_weakref_cycle_breaker())
	results.append(test_event_bus_dead_token_lazy_pruning())
	results.append(test_auxiliary_worker_pool_fifo_cache_budget())
	results.append(test_auxiliary_worker_pool_task_closure_cleanup())
	results.append(test_auth_service_expired_token_no_reanimation())
	results.append(test_auth_service_unregister_hook())
	results.append(test_versioned_runtime_context_dispose())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "内存泄漏生命周期防御与引用解环",
		"all_passed": all_passed,
		"results": results
	}

## TC-MEM-01: EventBusSubscriptionToken WeakRef 解环验证
static func test_event_bus_token_weakref_cycle_breaker() -> Dictionary:
	var local_bus := EventBusCore.new()
	var bus_weak := weakref(local_bus)
	var callback_called := false
	var cb := func(_pkt: EventPacket):
		callback_called = true

	var token := local_bus.subscribe(101, 0, cb)
	var token_has_bus: bool = (token.bus != null)

	# 释放外部总线强引用，若存在循环强引用则 local_bus 析构受阻；若解环成功则 bus_weak.get_ref() 为 null
	local_bus = null
	var bus_freed: bool = (bus_weak.get_ref() == null)
	var token_bus_null_after_freed: bool = (token.bus == null)

	# 验证在总线已析构状态下调用 unbind 依然安全幂等
	var unbind_safe: bool = token.unbind()
	var unbind_idempotent: bool = (not token.unbind())

	var passed: bool = token_has_bus and bus_freed and token_bus_null_after_freed and unbind_safe and unbind_idempotent
	return {
		"test": "TC-MEM-01: EventBusSubscriptionToken WeakRef 解环验证",
		"passed": passed,
		"detail": "token_has_bus=%s, bus_freed=%s, token_bus_null=%s, unbind_safe=%s" % [token_has_bus, bus_freed, token_bus_null_after_freed, unbind_safe]
	}

## TC-MEM-02: EventBusCore dispatch_now 死亡令牌懒惰修剪验证
static func test_event_bus_dead_token_lazy_pruning() -> Dictionary:
	var local_bus := EventBusCore.new()
	var channel_id := 202

	# 1. 创建有效订阅
	var valid_token := local_bus.subscribe(channel_id, 0, func(_p): pass)

	# 2. 创建临时目标对象并绑定其方法，随后释放该目标对象使 Callable 变为失效（invalid）
	var dummy_target := RefCounted.new()
	var dead_cb := Callable(dummy_target, "get_instance_id")
	var dead_token := local_bus.subscribe(channel_id, 0, dead_cb)
	dummy_target = null # 释放目标对象，此时 dead_cb.is_valid() == false

	# 派发前路由表包含 2 个订阅
	var pre_count: int = local_bus._channel_routes.get(channel_id, []).size()

	# 3. 触发派发，验证派发循环检测到失效 Callable 并自动从路由表中修剪注销
	var pkt := EventPacket.new()
	pkt.channel_id = channel_id
	local_bus.dispatch_now(pkt)

	var post_routes: Array = local_bus._channel_routes.get(channel_id, [])
	var post_count: int = post_routes.size()
	var dead_removed: bool = (not post_routes.has(dead_token))
	var valid_retained: bool = post_routes.has(valid_token)

	var passed: bool = (pre_count == 2) and (post_count == 1) and dead_removed and valid_retained
	return {
		"test": "TC-MEM-02: EventBusCore dispatch_now 死亡令牌懒惰修剪验证",
		"passed": passed,
		"detail": "pre=%d, post=%d, dead_removed=%s, valid_retained=%s" % [pre_count, post_count, dead_removed, valid_retained]
	}

## TC-MEM-03: AuxiliaryWorkerPool FIFO 缓存容量上限截断验证
static func test_auxiliary_worker_pool_fifo_cache_budget() -> Dictionary:
	AuxiliaryWorkerPool.reset_for_tests()
	var pool: Variant = AuxiliaryWorkerPool.get_instance()

	# 模拟连续缓存写入 70 项（默认预算为 64 项）
	for i in range(70):
		var p := "res://mock/path_%d.json" % i
		pool._cache_result(p, {"index": i})

	var cache_size: int = pool._cached_results.size()
	var fifo_size: int = pool._cache_keys_fifo.size()
	var oldest_evicted: bool = (not pool._cached_results.has("res://mock/path_0.json"))
	var newest_retained: bool = pool._cached_results.has("res://mock/path_69.json")

	var evicted_count: int = int(pool.evict_idle_resources())
	var clean_size: int = pool._cached_results.size()
	var clean_fifo: int = pool._cache_keys_fifo.size()

	AuxiliaryWorkerPool.reset_for_tests()
	var passed: bool = (cache_size == 64) and (fifo_size == 64) and oldest_evicted and newest_retained and (evicted_count == 64) and (clean_size == 0) and (clean_fifo == 0)
	return {
		"test": "TC-MEM-03: AuxiliaryWorkerPool FIFO 缓存容量上限截断验证",
		"passed": passed,
		"detail": "cache_size=%d, fifo_size=%d, oldest_evicted=%s, clean_size=%d" % [cache_size, fifo_size, oldest_evicted, clean_size]
	}

## TC-MEM-04: AuxiliaryWorkerPool 任务完成即时解绑闭包验证
static func test_auxiliary_worker_pool_task_closure_cleanup() -> Dictionary:
	AuxiliaryWorkerPool.reset_for_tests()
	var pool: Variant = AuxiliaryWorkerPool.get_instance()

	var callback_executed := false
	var task_id: int = int(pool.request_resource_async("res://config/game_config.json", 1, null, func(ok: bool, _data, _err):
		callback_executed = true
	))

	# 提取已完成任务并检查其闭包引用已被释放
	var completed_task_found := false
	var callback_freed := false
	for t in pool._completed_tasks:
		if t.task_id == task_id:
			completed_task_found = true
			callback_freed = (not t.callback.is_valid())
			break

	AuxiliaryWorkerPool.reset_for_tests()
	var passed: bool = callback_executed and completed_task_found and callback_freed
	return {
		"test": "TC-MEM-04: AuxiliaryWorkerPool 任务完成即时解绑闭包验证",
		"passed": passed,
		"detail": "executed=%s, task_found=%s, callback_freed=%s" % [callback_executed, completed_task_found, callback_freed]
	}

## TC-MEM-05: AuthService validate_token 过期会话不写回复活验证
static func test_auth_service_expired_token_no_reanimation() -> Dictionary:
	AuthService.reset_for_tests()
	var dummy_token := "expired_test_token_sample_string"
	var token_hash := dummy_token.sha256_text()

	var now := int(Time.get_unix_time_from_system())
	# 注入一个 100 秒前已过期的会话
	AuthService._sessions[token_hash] = {
		"account_id": "ACC_EXPIRED_01",
		"issued_at": now - 300,
		"expires_at": now - 100,
		"revoked": false
	}

	var pre_contains: bool = AuthService._sessions.has(token_hash)
	var res: Dictionary = AuthService.validate_token(dummy_token, "", "", now)
	var err_code: String = str(res.get("error_code", ""))
	var post_contains: bool = AuthService._sessions.has(token_hash)

	AuthService.reset_for_tests()
	var passed: bool = pre_contains and (err_code == "TOKEN_EXPIRED") and (not post_contains)
	return {
		"test": "TC-MEM-05: AuthService validate_token 过期会话不写回复活验证",
		"passed": passed,
		"detail": "pre=%s, err=%s, post_contains=%s" % [pre_contains, err_code, post_contains]
	}

## TC-MEM-06: AuthService unregister_hook 钩子精确注销验证
static func test_auth_service_unregister_hook() -> Dictionary:
	AuthService.clear_hooks()
	var trigger_count := 0
	var hook_cb := func(_payload):
		trigger_count += 1

	AuthService.register_hook("post_test", hook_cb)
	AuthService._dispatch_auth_hooks("post_test", {"value": 1})
	var count_after_first := trigger_count

	# 精确解绑 Hook
	var unregister_ok: bool = AuthService.unregister_hook("post_test", hook_cb)
	var unregister_repeat: bool = AuthService.unregister_hook("post_test", hook_cb)

	AuthService._dispatch_auth_hooks("post_test", {"value": 2})
	var count_after_unreg := trigger_count

	AuthService.clear_hooks()
	var passed: bool = (count_after_first == 1) and unregister_ok and (not unregister_repeat) and (count_after_unreg == 1)
	return {
		"test": "TC-MEM-06: AuthService unregister_hook 钩子精确注销验证",
		"passed": passed,
		"detail": "c1=%d, unreg_ok=%s, unreg_repeat=%s, c2=%d" % [count_after_first, unregister_ok, unregister_repeat, count_after_unreg]
	}

## TC-MEM-07: VersionedRuntimeContext dispose 成员完全释放验证
static func test_versioned_runtime_context_dispose() -> Dictionary:
	var ctx := VersionedRuntimeContext.new("1.0.0", 10000, ActivationTokenDTO.new())
	ctx.config_snapshot = {"test_domain": {"key": "val"}}
	ctx.is_active = true

	var pre_has_snapshot: bool = (not ctx.config_snapshot.is_empty())
	var pre_has_token: bool = (ctx.activation_token != null)

	ctx.dispose()

	var post_snapshot_clean: bool = ctx.config_snapshot.is_empty()
	var post_token_clean: bool = (ctx.activation_token == null)
	var post_active_clean: bool = (not ctx.is_active)

	var passed: bool = pre_has_snapshot and pre_has_token and post_snapshot_clean and post_token_clean and post_active_clean
	return {
		"test": "TC-MEM-07: VersionedRuntimeContext dispose 成员完全释放验证",
		"passed": passed,
		"detail": "pre_snap=%s, post_snap=%s, post_tok=%s, post_active=%s" % [pre_has_snapshot, post_snapshot_clean, post_token_clean, post_active_clean]
	}
