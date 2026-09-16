# ==============================================================================
# 单元测试：领域 21 聊天框指令与奖励发放 (Chat Command Tests)
# 文件路径: res://tests/unit/domains/test_chat_command.gd
# ==============================================================================
class_name TestChatCommandDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_command_parsing())
	results.append(test_command_registration_and_dispatch())
	results.append(test_cdkey_redemption())
	results.append(test_gm_command_index())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 21: 聊天框指令与奖励发放", "all_passed": all_passed, "results": results }

static func test_command_parsing() -> Dictionary:
	var ast = ChatCommandParser.parse_input_line("/give gold 500 count=10")
	var passed = ast.is_command and (ast.command_name == "give") and (ast.raw_arguments.size() == 2) and (ast.raw_arguments[1] == 500) and (ast.named_arguments.get("count", 0) == 10)
	return { "test": "TC-CMD-01: 斜杠指令词法分析与 AST 语法树生成", "passed": passed }

## 使用具名静态处理器替代 lambda：静态注册表持留匿名 Callable 会在脚本卸载后
## 释放悬垂引用，导致进程退出阶段 SIGSEGV。同时测试结束必须注销，避免污染全局。
static func _heal_handler(_ast, _context) -> Dictionary:
	return { "success": true, "healed": true }

static func test_command_registration_and_dispatch() -> Dictionary:
	var registered_before := CommandRegistryEngine.registered_count()
	CommandRegistryEngine.register_command("heal", _heal_handler, 0)

	var admin := AdminPermissionAggregate.new()
	var ast = ChatCommandParser.parse_input_line("/heal")
	var res = CommandRegistryEngine.dispatch_command(ast, admin, {})
	var passed = res.success and res.healed

	# 测试隔离：还原全局注册表
	CommandRegistryEngine.unregister_command("heal")
	passed = passed and (CommandRegistryEngine.registered_count() == registered_before) \
		and (not CommandRegistryEngine.has_command("heal"))
	return { "test": "TC-CMD-02: 指令动态注册与无缝分发执行", "passed": passed }

static func test_cdkey_redemption() -> Dictionary:
	var wallet := CharacterWalletEntity.new()
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 20
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	var res_ok = RewardDispatchPipeline.redeem_cdkey("KALAR666", "USER_TEST_01", wallet, inv, catalog)
	var res_duplicate = RewardDispatchPipeline.redeem_cdkey("KALAR666", "USER_TEST_01", wallet, inv, catalog)

	# 注册表三元组发放：template_id 落 canonical_id，质量/体积取原型值
	var item: ItemEntity = inv.storage_items[0] if inv.storage_items.size() > 0 else null
	var item_ok = item != null \
		and item.template_id == "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD" \
		and is_equal_approx(item.mass_kg, 1.5) and item.volume_slots == 2

	# 背包容量不足（容量 0）→ 严格拒绝：货币未入账、兑换码未消耗（原子性，可重试不刷取）
	var wallet2 := CharacterWalletEntity.new()
	var inv2 := WearableInventoryAggregate.new()
	var res_full = RewardDispatchPipeline.redeem_cdkey("KALAR888", "USER_TEST_02", wallet2, inv2, catalog)
	var full_rejected = (not res_full.success) and inv2.storage_items.is_empty() and (wallet2.gold == 0)

	# 失败未消耗兑换码：扩容后重试同一账户同一码成功（金币仅到账一次）
	inv2.baseline_capacity = 20
	var res_retry = RewardDispatchPipeline.redeem_cdkey("KALAR888", "USER_TEST_02", wallet2, inv2, catalog)
	var retry_ok = res_retry.success and (wallet2.gold == 1000) and (inv2.storage_items.size() == 1)

	var passed = res_ok.success and (wallet.gold == 500) and item_ok and (not res_duplicate.success) and full_rejected and retry_ok
	return { "test": "TC-CMD-03: CDKey 兑换核销与注册表三元组发放（防重复/原型属性/容量拒绝原子性）", "passed": passed }

static func test_gm_command_index() -> Dictionary:
	var index := GmCommandIndexSolver.new()
	# MRU 去重置顶 + 窗口截断（默认窗口 20，超出即回收最旧）
	for i in range(25):
		index.record_usage("cmd_%02d" % i)
	var recent_ok = index.recent_count() == 20

	# 最近使用排最前 + 前缀过滤 + 分页（page_size 5 -> 4 页）
	var q0 = index.query("cmd_")
	var order_ok = q0.total == 20 and str(q0.entries[0]) == "cmd_24" and q0.total_pages == 4
	var page_ok = q0.entries.size() == 5

	# 滚动分页：游标推进到第 2 页
	var q1 = index.next_page("cmd_")
	var scroll_ok = q1.page_index == 1 and q1.entries.size() == 5

	# 页缓冲池回收：多轮查询后池容量不超过 max_pages（4），内存有界
	var pool_ok = index.page_pool_size() <= 4

	# 最近适配补全：最近使用中首个前缀匹配命令
	var completion = index.apply_recent_completion("cmd_")
	var completion_ok = completion.success and completion.command == "/cmd_24"

	# 无最近记录时回退默认命令目录
	var fresh := GmCommandIndexSolver.new()
	var def_q = fresh.query("gi")
	var default_ok = def_q.total == 1 and str(def_q.entries[0]) == "give"

	var passed = recent_ok and order_ok and page_ok and scroll_ok and pool_ok and completion_ok and default_ok
	return {
		"test": "TC-CMD-04: GM 命令索引最近20条窗口/分页滚动/页池回收/默认回退/最近适配补全",
		"passed": passed
	}
