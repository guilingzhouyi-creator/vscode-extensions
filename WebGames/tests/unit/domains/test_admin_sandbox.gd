# ==============================================================================
# 单元测试：领域 20 管理员权限与沙盒作弊 (Admin Sandbox Tests)
# 文件路径: res://tests/unit/domains/test_admin_sandbox.gd
# ==============================================================================
class_name TestAdminSandboxDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_rbac_elevation())
	results.append(test_god_mode_execution())
	results.append(test_audit_logging())
	results.append(test_bootstrap_assembly())
	results.append(test_gm_give_item_registry_resolution())
	# Phase 43 P2-12 新增：审计日志有界化（audit/max_entries 裁剪，最旧先出）
	results.append(test_audit_log_cap_pruning())
	results.append(test_gm_command_catalog_dispatch())
	results.append(test_clawback_service())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 20: 管理员权限与沙盒作弊", "all_passed": all_passed, "results": results }

static func test_rbac_elevation() -> Dictionary:
	var admin := AdminPermissionAggregate.new()
	var initial_denied = not admin.has_permission(AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER)
	var elevated = admin.elevate_permission("KALAR_GOD_MODE_2026", AdminPermissionAggregate.AdminLevel.LEVEL_ROOT_ADMIN)
	var now_granted = admin.has_permission(AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER)
	var passed = initial_denied and elevated and now_granted
	return { "test": "TC-ADMIN-01: RBAC 动态提权与权限矩阵拦截", "passed": passed }

static func test_god_mode_execution() -> Dictionary:
	var admin := AdminPermissionAggregate.new()
	admin.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_ROOT_ADMIN

	var sheet := CharacterPhysiologySheet.new()
	sheet.set_level("STR", 1)

	var cheat_res = SandboxCheatSolver.execute_cheat_command(admin, "GOD_MODE", [], { "sheet": sheet })
	var passed = cheat_res.success and (sheet.get_level("STR") == AttributeConversionEngine.max_level()) and (sheet.heart_core_integrity == 1.0)
	return { "test": "TC-ADMIN-02: 上帝模式作弊指令注入与全属性拉满", "passed": passed }

static func test_audit_logging() -> Dictionary:
	var entry = GMArbitrationAuditService.record_audit("GM_TEST_01", "GIVE_GOLD", { "amount": 10000 })
	var passed = (entry.admin_id == "GM_TEST_01") and (entry.signature != "")
	return { "test": "TC-ADMIN-03: GM 仲裁日志审计与防篡改签名", "passed": passed }

## Phase 43 P2-12（TC-P43-S4-07）：审计日志有界化——record_audit 后按
## audit/max_entries 裁剪，最旧先出（注入超上限条数 → 尺寸≤上限且最早条目被裁）。
static func test_audit_log_cap_pruning() -> Dictionary:
	var max_entries := maxi(1, GameConfig.get_int("infrastructure.admin", "audit/max_entries", 500))
	var before: int = GMArbitrationAuditService.audit_log.size()
	# 注入 max_entries + 8 条（超越既有残留累计也必超上限）
	for i in range(max_entries + 8):
		GMArbitrationAuditService.record_audit("GM_CAP", "CAP_ACTION_%d" % i, { "seq": i })
	var size_ok: bool = GMArbitrationAuditService.audit_log.size() <= max_entries
	# 最旧先出：最新注入的第 max_entries+7 条应留存
	var newest_kept := false
	for e in GMArbitrationAuditService.audit_log:
		if str(e.get("action", "")) == "CAP_ACTION_%d" % (max_entries + 7):
			newest_kept = true
			break
	# 既有最旧残留（如 TC-ADMIN-03 的 GIVE_GOLD）应已被裁出（若超上限成立）
	var passed = size_ok and newest_kept and GMArbitrationAuditService.audit_log.size() == max_entries
	return { "test": "TC-P43-S4-07: 审计有界化（尺寸≤上限，最旧先出）", "passed": passed, "before": before, "size": GMArbitrationAuditService.audit_log.size() }

static func test_bootstrap_assembly() -> Dictionary:
	var res := GameBootstrap.assemble()
	var catalog := GameBootstrap.catalog()

	# 物品注册表装配：core 表全量登记，统一英文名可解析
	var item_ok = res.item_count >= 6 \
		and ItemRegistrySolver.resolve_by_english_name(catalog, "mithril_longsword").success

	# 内置 GM 命令注册
	var cmd_ok = CommandRegistryEngine.has_command("give") \
		and CommandRegistryEngine.has_command("gold") \
		and CommandRegistryEngine.has_command("god") \
		and CommandRegistryEngine.has_command("time")

	# 经装配 catalog 走通 /give 分发闭环
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 20
	var gm_admin := AdminPermissionAggregate.new()
	gm_admin.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	var context := { "admin": gm_admin, "inventory": inv, "catalog": catalog }
	var ast = ChatCommandParser.parse_input_line("/give mithril_longsword")
	var dispatch = CommandRegistryEngine.dispatch_command(ast, gm_admin, context)
	var dispatch_ok = dispatch.success and inv.storage_items.size() == 1

	var passed = item_ok and cmd_ok and dispatch_ok
	return {
		"test": "TC-ADMIN-06: 全域启动装配（注册表+内置命令+分发闭环）",
		"passed": passed
	}

static func test_gm_give_item_registry_resolution() -> Dictionary:
	var admin := AdminPermissionAggregate.new()
	admin.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_ROOT_ADMIN
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 20
	var catalog := ItemLoaderPipeline.build_catalog_from_config()

	# 统一英文名命中注册表 -> 生成对应物品（template_id 落 canonical_id，质量/体积取原型值）
	var res = SandboxCheatSolver.execute_cheat_command(
		admin, "GIVE_ITEM", ["mithril_longsword"], { "inventory": inv, "catalog": catalog }
	)
	var item: ItemEntity = inv.storage_items[0] if inv.storage_items.size() > 0 else null
	var alias_ok = res.success and res.count_added == 1 \
		and item != null \
		and item.template_id == "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD" \
		and is_equal_approx(item.mass_kg, 1.5) and item.volume_slots == 2

	# 中文别名与数字 ID 一律拒绝（仅接受统一英文名）
	var res_zh = SandboxCheatSolver.execute_cheat_command(
		admin, "GIVE_ITEM", ["秘银剑"], { "inventory": inv, "catalog": catalog }
	)
	var res_num = SandboxCheatSolver.execute_cheat_command(
		admin, "GIVE_ITEM", ["1001"], { "inventory": inv, "catalog": catalog }
	)
	var zh_rejected_ok = not res_zh.success
	var num_rejected_ok = not res_num.success

	# 注册表上下文必填：缺失 catalog 直接拒绝（无兼容临时物件路径）
	var res_no_registry = SandboxCheatSolver.execute_cheat_command(
		admin, "GIVE_ITEM", ["mithril_longsword"], { "inventory": inv }
	)
	var no_registry_ok = not res_no_registry.success

	# 数量参数：count=3 发放 3 件独立实例
	var inv2 := WearableInventoryAggregate.new()
	inv2.baseline_capacity = 20
	var res_count = SandboxCheatSolver.execute_cheat_command(
		admin, "GIVE_ITEM", ["mithril_longsword", "3"], { "inventory": inv2, "catalog": catalog }
	)
	var count_ok = res_count.count_added == 3 and inv2.storage_items.size() == 3

	var passed = alias_ok and zh_rejected_ok and num_rejected_ok and no_registry_ok and count_ok
	return {
		"test": "TC-ADMIN-04: GM /give 统一英文名物品发放（英文名解析/中文与数字 ID 拒绝/注册表必填/数量发放）",
		"passed": passed
	}

static func test_gm_command_catalog_dispatch() -> Dictionary:
	# 幂等隔离：先清理再注册
	GmCommandCatalog.unregister_default_commands()
	GmCommandCatalog.register_default_commands()

	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 20
	var gm_admin := AdminPermissionAggregate.new()
	gm_admin.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	var context := { "admin": gm_admin, "inventory": inv, "catalog": catalog }

	# /give 统一英文名 经命令注册表分发成功（handler 桥接沙盒求解器）
	var ast = ChatCommandParser.parse_input_line("/give mithril_longsword")
	var res = CommandRegistryEngine.dispatch_command(ast, gm_admin, context)
	var give_ok = res.success \
		and res.canonical_id == "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD" \
		and inv.storage_items.size() == 1

	# 普通玩家（LEVEL_PLAYER）被 min_admin_level 门禁拦截
	var player := AdminPermissionAggregate.new()
	var ast2 = ChatCommandParser.parse_input_line("/give mithril_longsword")
	var res_denied = CommandRegistryEngine.dispatch_command(ast2, player, context)
	var denied_ok = not res_denied.success

	# 严格语法：/give id <英文名> 等非规范形态一律拒绝（无兼容前缀）
	var ast_id = ChatCommandParser.parse_input_line("/give id mithril_longsword 2")
	var res_id = CommandRegistryEngine.dispatch_command(ast_id, gm_admin, context)
	var id_prefix_rejected = not res_id.success

	# 未注册命令 -> unknown
	var ast3 = ChatCommandParser.parse_input_line("/nope")
	var res_unknown = CommandRegistryEngine.dispatch_command(ast3, gm_admin, context)
	var unknown_ok = not res_unknown.success

	# 测试隔离：注销内置命令，还原全局注册表
	GmCommandCatalog.unregister_default_commands()
	var cleaned = (not CommandRegistryEngine.has_command("give")) and (not CommandRegistryEngine.has_command("gold"))

	var passed = give_ok and denied_ok and id_prefix_rejected and unknown_ok and cleaned
	return {
		"test": "TC-ADMIN-05: 内置 GM 命令目录注册/分发/权限门禁/严格语法/隔离清理",
		"passed": passed
	}

static func test_clawback_service() -> Dictionary:
	# P39 清单 6：审计签名密钥经环境供给——测试显式注入（缺钥即失败关闭，签名不可用）
	OS.set_environment("KALAR_ENTITLEMENT_KEY", "test-seal-key-v1")
	var gm := AdminPermissionAggregate.new()
	gm.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	gm.granted_permissions = ["CLAWBACK"]  # P39 清单 5：GM 追缴需显式授权权限（空权限集合不放行）
	var player := AdminPermissionAggregate.new() # LEVEL_PLAYER
	var online := ClawbackService.RUN_MODE_ONLINE
	var standalone := ClawbackService.RUN_MODE_STANDALONE

	# 边界 1：单机模式一律拒绝（联机才可用）
	var r_offline = ClawbackService.clawback_currency(
		player, standalone, "gold", 100, ClawbackService.REASON_CHEAT_DETECTED, CharacterWalletEntity.new()
	)
	var offline_ok = (not r_offline.success) and r_offline.error_code == "CLAWBACK_OFFLINE_FORBIDDEN"

	# 边界 2：权限门槛（PLAYER 即便联机也拒绝）
	var r_perm = ClawbackService.clawback_currency(
		player, online, "gold", 100, ClawbackService.REASON_CHEAT_DETECTED, CharacterWalletEntity.new()
	)
	var perm_ok = (not r_perm.success) and r_perm.error_code == "CLAWBACK_PERMISSION_DENIED"

	# 边界 2b（P39 清单 5）：空权限集合的 GM 不能仅凭等级放行（权限集合为权威）
	var gm_empty := AdminPermissionAggregate.new()
	gm_empty.current_level = AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	var r_empty_perm = ClawbackService.clawback_currency(
		gm_empty, online, "gold", 100, ClawbackService.REASON_CHEAT_DETECTED, CharacterWalletEntity.new()
	)
	var empty_perm_ok = (not r_empty_perm.success) and r_empty_perm.error_code == "CLAWBACK_PERMISSION_DENIED"

	# 货币追缴：全额扣减、支持扣至负数（超额部分记为欠账/赤字）
	var wallet := CharacterWalletEntity.new()
	wallet.gold = 1000
	var r_cur = ClawbackService.clawback_currency(
		gm, online, "gold", 5000, ClawbackService.REASON_EXPLOIT_ABUSE, wallet
	)
	var cur_ok = r_cur.success and (wallet.gold == -4000) and (r_cur.actual_clawed == 5000) \
		and r_cur.into_debt and (r_cur.net_debt_copper > 0)

	# 原型物品追缴：按 canonical_id 批量回扣，超额钳制到实际持有数
	var catalog := GameBootstrap.catalog()
	var inv := WearableInventoryAggregate.new()
	inv.baseline_capacity = 20
	for i in range(3):
		var item := ItemEntity.from_payload(ItemRegistrySolver.build_instance_payload(
			catalog.get_prototype("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD"), "mithril_longsword"
		))
		item.item_id = UniqueIdGenerator.next_id("GM_ITEM_")
		inv.add_item(item)
	var r_proto = ClawbackService.clawback_item_prototype(
		gm, online, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 5, ClawbackService.REASON_MANUAL_AUDIT, inv
	)
	var proto_ok = r_proto.success and (r_proto.actual_clawed == 3) and r_proto.clamped and inv.storage_items.is_empty()

	# 实例追缴：按 item_id 精确回扣单件
	var inv2 := WearableInventoryAggregate.new()
	inv2.baseline_capacity = 20
	var target := ItemEntity.from_payload(ItemRegistrySolver.build_instance_payload(
		catalog.get_prototype("KALAR:CONSUM:ALCHEMY:POTION_MANA"), "potion_mana"
	))
	target.item_id = "GM_TARGET_01"
	inv2.add_item(target)
	var r_inst = ClawbackService.clawback_item_instance(
		gm, online, "GM_TARGET_01", ClawbackService.REASON_CHEAT_DETECTED, inv2
	)
	var inst_ok = r_inst.success and inv2.storage_items.is_empty()

	# 余额 0 追缴：同样支持扣至负数（欠账），不拒绝
	var wallet3 := CharacterWalletEntity.new()
	var r_debt = ClawbackService.clawback_currency(
		gm, online, "gold", 100, ClawbackService.REASON_CHEAT_DETECTED, wallet3
	)
	var debt_ok = r_debt.success and (wallet3.gold == -100) and r_debt.into_debt

	# 审计留痕：最近审计含追缴动作且签名非空
	var audits = GMArbitrationAuditService.get_recent_audits(50)
	var found_audit := false
	for entry in audits:
		if str(entry.get("action", "")).begins_with("CLAWBACK") and str(entry.get("signature", "")) != "":
			found_audit = true
			break
	var audit_ok = found_audit

	var passed = offline_ok and perm_ok and empty_perm_ok and cur_ok and proto_ok and inst_ok and debt_ok and audit_ok
	return {
		"test": "TC-ADMIN-07: 追缴服务边界规范（联机限定/权限门槛含空权限集合拒绝/货币扣至负数欠账/物品超额钳制/审计留痕）",
		"passed": passed
	}
