# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 40 全域通知与红点树系统单元测试
# 文件路径: res://tests/unit/domains/test_notification_red_dot.gd
# ==============================================================================
class_name TestNotificationRedDotDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 40: 全域通知与有向红点树状态机系统"

	results.append(_test_red_dot_recursive_bubble_up())
	results.append(_test_red_dot_clear_and_parent_sync())
	results.append(_test_four_tier_notification_push())
	# Phase 56 L4 新增：递归环检测
	results.append(_test_upwards_cycle_terminates())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_red_dot_recursive_bubble_up() -> Dictionary:
	var registry := {}
	# 建立三层树: menu -> menu.mail -> menu.mail.unread
	var root_node := RedDotTreeNode.new("menu", "", 0, ["menu.mail"])
	var mail_node := RedDotTreeNode.new("menu.mail", "menu", 0, ["menu.mail.unread"])
	var unread_node := RedDotTreeNode.new("menu.mail.unread", "menu.mail", 0, [])

	registry["menu"] = root_node
	registry["menu.mail"] = mail_node
	registry["menu.mail.unread"] = unread_node

	# 设置底层叶子节点新增 5 封未读邮件
	RedDotTreeFsm.set_node_direct_count(registry, "menu.mail.unread", 5)

	var passed = (unread_node.total_aggregated_count == 5) and \
				 (mail_node.total_aggregated_count == 5) and \
				 (root_node.total_aggregated_count == 5)

	return {
		"test": "TC-REDDOT-01: 叶子节点变动自发向上冒泡与父级链聚合汇总",
		"passed": passed
	}

static func _test_red_dot_clear_and_parent_sync() -> Dictionary:
	var registry := {}
	var root_node := RedDotTreeNode.new("menu", "", 0, ["menu.bag", "menu.mail"])
	var bag_node := RedDotTreeNode.new("menu.bag", "menu", 2, [])
	var mail_node := RedDotTreeNode.new("menu.mail", "menu", 3, [])

	registry["menu"] = root_node
	registry["menu.bag"] = bag_node
	registry["menu.mail"] = mail_node

	RedDotTreeFsm.recalculate_node_upwards(registry, "menu.bag")
	RedDotTreeFsm.recalculate_node_upwards(registry, "menu.mail")

	var total_before = root_node.total_aggregated_count # 2 + 3 = 5

	# 清空邮件红点
	RedDotTreeFsm.set_node_direct_count(registry, "menu.mail", 0)
	var total_after = root_node.total_aggregated_count # 2 + 0 = 2

	var passed = (total_before == 5) and (total_after == 2) and (mail_node.total_aggregated_count == 0)
	return {
		"test": "TC-REDDOT-02: 子节点消除后父节点红点数量自适应扣减同步",
		"passed": passed
	}

static func _test_four_tier_notification_push() -> Dictionary:
	var queue := []
	var toast := RedDotTreeNode.NotificationDTO.new("N_01", RedDotTreeNode.NotificationDTO.NoticeType.TOAST, "提示", "获得金币")
	var modal := RedDotTreeNode.NotificationDTO.new("N_02", RedDotTreeNode.NotificationDTO.NoticeType.MODAL_DIALOG, "确认", "是否分解装备")

	var r1 = NotificationPipeline.push_notification(queue, toast)
	var r2 = NotificationPipeline.push_notification(queue, modal)

	var passed = r1.pushed and r2.pushed and (queue.size() == 2)
	return {
		"test": "TC-REDDOT-03: 四级通知数据契约推流与渲染完全解耦",
		"passed": passed
	}

## L4（Phase 56）：向上冒泡递归带环检测——parent_path 成环不再无限递归栈溢出（红证：修复前爆栈）
static func _test_upwards_cycle_terminates() -> Dictionary:
	var a := RedDotTreeNode.new("A")
	var b := RedDotTreeNode.new("B")
	a.parent_path = "B"
	b.parent_path = "A" # 成环：A→B→A
	var registry := { "A": a, "B": b }
	a.direct_count = 3
	b.direct_count = 2

	RedDotTreeFsm.recalculate_node_upwards(registry, "A") # 不应栈溢出
	# children_paths 为空：各节点聚合值 == 自身 direct_count（测试聚焦「环终止不爆栈」，非树聚合语义）
	var finite = a.total_aggregated_count == 3 and b.total_aggregated_count == 2
	# 自指也安全
	var c := RedDotTreeNode.new("C")
	c.parent_path = "C"
	RedDotTreeFsm.recalculate_node_upwards({ "C": c }, "C")
	var passed = finite and c.total_aggregated_count == 0
	return { "test": "TC-REDDOT-04: 递归环检测（L4：成环/自指终止不爆栈）", "passed": passed }
