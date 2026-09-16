# ==============================================================================
# 单元测试：Phase 69 资源生命周期治理与释放 (Resource Lifecycle Governance)
# 文件路径: res://tests/unit/infrastructure/test_resource_lifecycle_governance.gd
# 职责: 验证资源纳管、状态推进、安全销毁、批量释放、信号自动解绑、度量计算（TC-RM-01 ~ TC-RM-10）
# ==============================================================================
class_name TestResourceLifecycleGovernance extends RefCounted

const ResourceLifecycleDescriptor = preload("res://backend/infrastructure/resource_governance/resource_lifecycle_descriptor.gd")
const ResourceLifecycleManager = preload("res://backend/infrastructure/resource_governance/resource_lifecycle_manager.gd")
const ScopedEventSubscriber = preload("res://backend/infrastructure/resource_governance/scoped_event_subscriber.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_track_resource())
	results.append(test_state_machine_transitions())
	results.append(test_single_node_dispose())
	results.append(test_dispose_all())
	results.append(test_dispose_idempotency())
	results.append(test_scoped_subscriber_bind())
	results.append(test_scoped_subscriber_duplicate_bind())
	results.append(test_scoped_subscriber_manual_unbind())
	results.append(test_scoped_subscriber_clear())
	results.append(test_live_metrics())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "Phase 69: 资源生命周期治理与释放",
		"all_passed": all_passed,
		"results": results
	}

## TC-RM-01: 资源管理器实例纳管
static func test_track_resource() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	var dummy_node := Control.new()
	var desc := mgr.track_resource("test_ctrl_1", dummy_node, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "UnitTest")
	
	var passed: bool = (desc != null) and (desc.current_state == ResourceLifecycleDescriptor.LifecycleState.INITIALIZED) and (desc.is_alive())
	dummy_node.free()
	return {
		"test": "TC-RM-01: 资源管理器实例纳管与描述符初始化",
		"passed": passed,
		"detail": "tracked state: %s" % (desc.current_state if desc != null else "null")
	}

## TC-RM-02: 状态机流转合法性校验
static func test_state_machine_transitions() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	var dummy_obj := RefCounted.new()
	var desc := mgr.track_resource("test_obj_2", dummy_obj, ResourceLifecycleDescriptor.ResourceCategory.CUSTOM_OBJECT, "UnitTest")
	
	var t1: bool = mgr.mark_in_use("test_obj_2") # INITIALIZED -> IN_USE
	var t2: bool = mgr.mark_idle("test_obj_2")   # IN_USE -> IDLE
	var t3: bool = mgr.mark_in_use("test_obj_2") # IDLE -> IN_USE
	var t4: bool = desc.transition_to(ResourceLifecycleDescriptor.LifecycleState.INITIALIZED) # 非法逆流应被拒绝
	
	var passed: bool = t1 and t2 and t3 and (not t4)
	return {
		"test": "TC-RM-02: 状态机流转合法性与逆流防御",
		"passed": passed,
		"detail": "t1=%s, t2=%s, t3=%s, invalid_t4=%s" % [t1, t2, t3, t4]
	}

## TC-RM-03: 单个节点安全销毁与物理回收
static func test_single_node_dispose() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	var node := Control.new()
	var parent := Control.new()
	parent.add_child(node)
	
	mgr.track_resource("child_node_3", node, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "ParentView")
	var disposed: bool = mgr.dispose_resource("child_node_3")
	
	var passed: bool = disposed and (not is_instance_valid(node)) and (mgr.get_descriptor("child_node_3") == null)
	parent.free()
	return {
		"test": "TC-RM-03: 单个节点安全销毁并脱离树",
		"passed": passed,
		"detail": "disposed=%s, node_alive=%s" % [disposed, is_instance_valid(node)]
	}

## TC-RM-04: 批量资源全量释放
static func test_dispose_all() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	for i in range(5):
		var n := Control.new()
		mgr.track_resource("batch_node_%d" % i, n, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "Batch")
	
	var freed: int = mgr.dispose_all()
	var metrics: Dictionary = mgr.get_live_metrics()
	var passed: bool = (freed == 5) and (int(metrics.get("total_tracked", -1)) == 0)
	return {
		"test": "TC-RM-04: 批量受控资源全量安全释放",
		"passed": passed,
		"detail": "freed=%d, total_remaining=%d" % [freed, int(metrics.get("total_tracked", -1))]
	}

## TC-RM-05: 重复释放幂等性防护
static func test_dispose_idempotency() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	var node := Control.new()
	mgr.track_resource("idem_node_5", node, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "Idem")
	
	var first_dispose: bool = mgr.dispose_resource("idem_node_5")
	var second_dispose: bool = mgr.dispose_resource("idem_node_5") # 再次销毁应返回 false，不抛出 Double Free
	
	var passed: bool = first_dispose and (not second_dispose)
	return {
		"test": "TC-RM-05: 重复释放幂等性防护与零崩溃",
		"passed": passed,
		"detail": "first=%s, second=%s" % [first_dispose, second_dispose]
	}

## TC-RM-06: 作用域订阅代理基础绑定
static func test_scoped_subscriber_bind() -> Dictionary:
	var subscriber := ScopedEventSubscriber.new()
	var node := Node.new()
	
	var sub_ok: bool = subscriber.subscribe(node.renamed, Callable(subscriber, "get_active_subscription_count"))
	var active_count: int = subscriber.get_active_subscription_count()
	
	var passed: bool = sub_ok and (active_count == 1) and node.renamed.is_connected(Callable(subscriber, "get_active_subscription_count"))
	subscriber.dispose()
	node.free()
	return {
		"test": "TC-RM-06: 作用域订阅代理基础绑定",
		"passed": passed,
		"detail": "sub_ok=%s, count=%d" % [sub_ok, active_count]
	}

## TC-RM-07: 作用域订阅代理重复绑定防御
static func test_scoped_subscriber_duplicate_bind() -> Dictionary:
	var subscriber := ScopedEventSubscriber.new()
	var node := Node.new()
	var cb := Callable(subscriber, "get_active_subscription_count")
	
	var sub1: bool = subscriber.subscribe(node.renamed, cb)
	var sub2: bool = subscriber.subscribe(node.renamed, cb) # 重复绑定应被拒绝
	
	var passed: bool = sub1 and (not sub2) and (subscriber.get_active_subscription_count() == 1)
	subscriber.dispose()
	node.free()
	return {
		"test": "TC-RM-07: 作用域订阅代理重复绑定防御",
		"passed": passed,
		"detail": "sub1=%s, sub2=%s, count=%d" % [sub1, sub2, subscriber.get_active_subscription_count()]
	}

## TC-RM-08: 作用域订阅单项手动解绑
static func test_scoped_subscriber_manual_unbind() -> Dictionary:
	var subscriber := ScopedEventSubscriber.new()
	var node := Node.new()
	var cb := Callable(subscriber, "get_active_subscription_count")
	
	subscriber.subscribe(node.renamed, cb)
	var unsub_ok: bool = subscriber.unsubscribe_from(node.renamed, cb)
	var is_still_connected: bool = node.renamed.is_connected(cb)
	
	var passed: bool = unsub_ok and (not is_still_connected) and (subscriber.get_active_subscription_count() == 0)
	subscriber.dispose()
	node.free()
	return {
		"test": "TC-RM-08: 作用域订阅单项精确解绑",
		"passed": passed,
		"detail": "unsub_ok=%s, connected=%s" % [unsub_ok, is_still_connected]
	}

## TC-RM-09: 宿主析构自动全量断开
static func test_scoped_subscriber_clear() -> Dictionary:
	var subscriber := ScopedEventSubscriber.new()
	var node1 := Node.new()
	var node2 := Node.new()
	var cb1 := Callable(subscriber, "get_active_subscription_count")
	var cb2 := Callable(subscriber, "clear")
	
	subscriber.subscribe(node1.renamed, cb1)
	subscriber.subscribe(node2.renamed, cb2)
	
	var cleared_cnt: int = subscriber.clear()
	var passed: bool = (cleared_cnt == 2) and (subscriber.get_active_subscription_count() == 0) and (not node1.renamed.is_connected(cb1)) and (not node2.renamed.is_connected(cb2))
	
	node1.free()
	node2.free()
	return {
		"test": "TC-RM-09: 宿主析构自动批量解绑零闭包残留",
		"passed": passed,
		"detail": "cleared_cnt=%d, remaining=%d" % [cleared_cnt, subscriber.get_active_subscription_count()]
	}

## TC-RM-10: 存活资源度量指标正确性
static func test_live_metrics() -> Dictionary:
	var mgr := ResourceLifecycleManager.new()
	var n1 := Control.new()
	var n2 := Control.new()
	var obj1 := RefCounted.new()
	
	mgr.track_resource("m_ctrl_1", n1, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "ViewA")
	mgr.track_resource("m_ctrl_2", n2, ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE, "ViewB")
	mgr.track_resource("m_custom_1", obj1, ResourceLifecycleDescriptor.ResourceCategory.CUSTOM_OBJECT, "Service")
	
	var metrics: Dictionary = mgr.get_live_metrics()
	var passed: bool = (int(metrics.get("total_tracked", 0)) == 3) and (int(metrics.get("active_ui_nodes", 0)) == 2) and (int(metrics.get("active_other_resources", 0)) == 1)
	
	mgr.dispose_all()
	return {
		"test": "TC-RM-10: 存活受控资源度量分类统计准确性",
		"passed": passed,
		"detail": "metrics: %s" % str(metrics)
	}
