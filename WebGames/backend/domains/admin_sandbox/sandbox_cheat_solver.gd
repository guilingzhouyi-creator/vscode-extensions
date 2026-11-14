# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/admin_sandbox/sandbox_cheat_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: currency_economy | 配置: infrastructure.admin.json | 信号: EventBus 领域广播
# 职责说明: 无敌模式、任意金币道具生成、属性强行修改、世界时钟快进与穿墙瞬移 数值与文案由 config/infrastructure/admin.json、narratives/admin.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SandboxCheatSolver：Headless Discrete Solver / Numerical Calculator
class_name SandboxCheatSolver extends RefCounted

## 解析并执行沙盒作弊控制台指令
static func execute_cheat_command(
	admin: AdminPermissionAggregate,
	command_name: String,
	command_arguments: Array,
	context: Dictionary
) -> Dictionary:
	if not admin.has_permission(AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER):
		var reason_message := GameConfig.get_string("narratives.admin", "insufficient_permission", "Insufficient GM permissions.")
		return { "success": false, "reason": reason_message }

	match command_name:
		"GOD_MODE":
			var sheet: CharacterPhysiologySheet = context.get("sheet", null)
			if sheet:
				sheet.heart_core_integrity = 1.0
				# 统一六维底座：全属性提升至 6 级满级（等级域经统一规则校验）
				for attribute_key in AttributeConversionEngine.DEFAULT_STAT_LIST:
					sheet.set_level(attribute_key, AttributeConversionEngine.max_level())
					sheet.set_progress(attribute_key, 1.0)
				LifecycleAndPhysiologySolver.calculate_somatic_function(sheet)
				EventBusCore.get_instance().emit_narrative_by_key(
					"admin/god_mode", "system", [AttributeConversionEngine.max_level()]
				)
				return { "success": true, "command": "GOD_MODE" }
		"GIVE_GOLD":
			var wallet: CharacterWalletEntity = context.get("wallet", null)
			var default_gold := GameConfig.get_int("infrastructure.admin", "sandbox/give_gold_default", 10000)
			var amount: Variant = int(command_arguments[0]) if command_arguments.size() > 0 else default_gold
			if wallet:
				wallet.apply_delta({ "gold": amount })
				EventBusCore.get_instance().emit_narrative_by_key("admin/give_gold", "system", [amount])
				return { "success": true, "gold_added": amount }
		"GIVE_ITEM":
			var inventory: WearableInventoryAggregate = context.get("inventory", null)
			if inventory == null:
				var no_inventory_message := GameConfig.get_string("narratives.admin", "give_item_no_inventory", "No inventory context for give item.")
				return { "success": false, "reason": no_inventory_message }
			# 物品注册表必填（严格按统一英文名发放，无兼容临时物件路径）
			var catalog: ItemRegistryCatalog = context.get("catalog", null)
			if catalog == null:
				var no_registry_message := GameConfig.get_string("narratives.admin", "give_item_no_registry", "No item registry context for give item.")
				return { "success": false, "reason": no_registry_message }
			var default_name := GameConfig.get_string("infrastructure.admin", "sandbox/give_item_default_name", "【GM创世神器】")
			var item_name: Variant = str(command_arguments[0]) if command_arguments.size() > 0 else default_name
			var count := int(command_arguments[1]) if command_arguments.size() > 1 else 1
			count = maxi(1, count)
			# 严格按统一英文名解析（唯一合法输入）：中文别名、数字 ID、canonical_id 一律拒绝
			var resolved: Variant = ItemRegistrySolver.resolve_by_english_name(catalog, item_name)
			if not resolved.success:
				var not_found_message := GameConfig.get_string("narratives.admin", "give_item_not_found", "Item not found in registry: %s") % item_name
				return { "success": false, "reason": not_found_message }
			var prototype: Variant = catalog.get_prototype(resolved.canonical_id)
			var added := 0
			for item_index in range(count):
				var granted_item := _build_registry_item(item_name, prototype)
				if inventory.add_item(granted_item):
					added += 1
			EventBusCore.get_instance().emit_narrative_by_key("admin/give_item", "system", [item_name])
			var item_statistics_library: AccountItemLibrary = context.get("item_stats_library", null)
			if item_statistics_library != null and added > 0:
				ItemStatisticsSolver.record_item_event(item_statistics_library, ItemStatisticsSolver.EVENT_ITEM_GRANTED, resolved.canonical_id, added, catalog, null, {
					"transaction_id": "GIVE_ITEM"
				})
			return { "success": true, "item_name": item_name, "count_added": added, "canonical_id": resolved.canonical_id }
		"ADVANCE_TIME":
			var clock: WorldClockMaster = context.get("clock", null)
			var default_months := GameConfig.get_int("infrastructure.admin", "sandbox/advance_time_default_months", 12)
			var months: Variant = int(command_arguments[0]) if command_arguments.size() > 0 else default_months
			if clock:
				clock.advance_calendar_months(months)
				EventBusCore.get_instance().emit_narrative_by_key("admin/advance_time", "system", [months])
				return { "success": true, "months_advanced": months }

	var template := GameConfig.get_string("narratives.admin", "unknown_command", "Unknown GM command: %s")
	return { "success": false, "reason": template % command_name }

## 构造 GM 发放物品实例（与服务器批量发放共用 build_instance_payload + 权威 UID）：
## template_id 落 canonical_id，质量/体积取原型值；实例 uid 前缀 GM_，item_id 走 IdGenerator（兼容）。
static func _build_registry_item(item_name: String, prototype: ItemRegistryCatalog.ItemPrototypeTemplate) -> ItemEntity:
	var prefix := GameConfig.get_string("infrastructure.admin", "sandbox/give_item_id_prefix", "GM_ITEM_")
	return ItemInstanceFactory.build_instance(prototype, item_name, "GM_", prefix)
