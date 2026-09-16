# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_state/hud_state_sync_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: world_navigation | 配置: config/domains/world_state.json | 信号: EventBus 领域广播
# 职责说明: 承担主页 HUD 双轨中枢： 拉轨（Pull Facade） -> get_hud_status_snapshot()：只读快照，字段 100% 真实溯源 推轨（Push EventBus）-> publish_hud_snapshot / publish_stat_mutation / publish_wallet_mutation 事实溯源（Phase 71 审查整改版，零臆造）： - 六维实值/层级 -> CharacterPhysiologySheet.get_actual_values()/get_all_levels() - hp_max -> domains.combat participant_defaults/max_hp（配置真源 + 下限守卫） - ap_max -> domains.world_state hud_defaults/ap_max（配置真源 + 下限守卫） - 钱包   -> CharacterWalletEntity.gold / mana_monocrystals 广播契约：payload 必带 category_key 与 args（EventBusCore.render_domain_event_text）
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name HudStateSyncService
extends RefCounted

## 1. 拉轨（Pull Facade）：聚合生成 HUD 状态快照 DTO（无副作用只读纯计算）
static func get_hud_status_snapshot(
	account_id: String,
	character_id: String,
	character_name: String,
	race_id: String,
	physiology: CharacterPhysiologySheet,
	wallet: CharacterWalletEntity,
	location_id: String = ""
) -> HudStatusSnapshotDTO:
	var snapshot := HudStatusSnapshotDTO.new()
	snapshot.account_id = account_id
	snapshot.character_id = character_id
	snapshot.character_name = character_name
	snapshot.race_id = race_id if not race_id.is_empty() else "HUMAN"
	snapshot.current_location_id = location_id

	# 六维实值与层级（真实 API，零臆造）
	if physiology != null:
		snapshot.attribute_values = physiology.get_actual_values().duplicate()
		snapshot.attribute_levels = physiology.get_all_levels().duplicate()

	# 展示型生命/行动力上限（配置真源 + 除数下限守卫 Inv-HDS-3）
	snapshot.hp_max = maxf(1.0, GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0))
	snapshot.ap_max = maxf(1.0, GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0))
	snapshot.hp_current = snapshot.hp_max
	snapshot.ap_current = snapshot.ap_max

	# 资产钱包（真实字段）
	if wallet != null:
		snapshot.wallet_gold = wallet.gold
		snapshot.wallet_mana_monocrystals = wallet.mana_monocrystals

	snapshot.timestamp_utc = int(Time.get_unix_time_from_system())
	return snapshot

## 2. 推轨（Push）：全量状态快照广播（携带叙事契约 args，模板键 snapshot_published）
static func publish_hud_snapshot(snapshot: HudStatusSnapshotDTO) -> void:
	if snapshot == null:
		return
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_hud_snapshot(), {
		"snapshot": snapshot.to_dto(),
		"category_key": "hud",
		"args": [snapshot.character_name]
	})

## 3. 增量推流：单项属性实值变更（stat_name 取值域 = physiology attribute 键）
static func publish_stat_mutation(character_id: String, stat_name: String, old_val: float, new_val: float, cause: String = "") -> void:
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_hud_stat_mutated(), {
		"character_id": character_id,
		"stat_name": stat_name,
		"old_value": old_val,
		"new_value": new_val,
		"delta": new_val - old_val,
		"cause_event": cause,
		"category_key": "hud",
		"args": [stat_name, old_val, new_val]
	})

## 4. 增量推流：钱包货币资产变更（currency_type 取值域 = CharacterWalletEntity.CURRENCY_FIELDS）
static func publish_wallet_mutation(account_id: String, currency_type: String, old_amt: int, new_amt: int, reason: String = "") -> void:
	EventBusCore.get_instance().emit_domain_event(HudEventContract.channel_hud_wallet_mutated(), {
		"account_id": account_id,
		"currency_type": currency_type,
		"old_amount": old_amt,
		"new_amount": new_amt,
		"delta": new_amt - old_amt,
		"reason_key": reason,
		"category_key": "hud",
		"args": [currency_type, new_amt - old_amt]
	})

## 5. 世界网关进世界首帧联动（复用既有 world_gateway.world_entered 触发点）
static func trigger_initial_world_sync(
	account_id: String,
	character_id: String,
	character_name: String,
	physiology: CharacterPhysiologySheet,
	wallet: CharacterWalletEntity,
	location_id: String = ""
) -> HudStatusSnapshotDTO:
	var snapshot := get_hud_status_snapshot(account_id, character_id, character_name, "HUMAN", physiology, wallet, location_id)
	publish_hud_snapshot(snapshot)
	return snapshot

# ==============================================================================
# Phase 72 首批现代接口接入示范（EventBus 2.0 整型信道 + 对象池借还闭环）
# 说明: 与上方 P71 字符串频道方法共存（迁移期双轨），borrow→dispatch→recycle
#       借还守恒；后续 P73/P74 迁移完成后字符串版本退役。
# ==============================================================================

## 6. v2：单项属性实值变更（整型信道 + 池化借还闭环）
static func publish_stat_mutation_v2(character_id: String, stat_name: String, old_val: float, new_val: float, cause: String = "") -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_STAT_MUTATED, EventCategoryMask.CORE_STATE)
	packet.source_entity_id = character_id
	var mut := HudMutationEventsDTO.StatMutation.new()
	mut.character_id = character_id
	mut.stat_name = stat_name
	mut.old_value = old_val
	mut.new_value = new_val
	mut.delta = new_val - old_val
	mut.cause_event = cause
	packet.payload_dto = mut
	packet.narrative_key = "stat_mutated"
	packet.narrative_args = [stat_name, old_val, new_val]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 7. v2：钱包货币资产变更（整型信道 + 池化借还闭环）
static func publish_wallet_mutation_v2(account_id: String, currency_type: String, old_amt: int, new_amt: int, reason: String = "") -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_WALLET_MUTATED, EventCategoryMask.CORE_STATE)
	var mut := HudMutationEventsDTO.WalletMutation.new()
	mut.account_id = account_id
	mut.currency_type = currency_type
	mut.old_amount = old_amt
	mut.new_amount = new_amt
	mut.delta = new_amt - old_amt
	mut.reason_key = reason
	packet.payload_dto = mut
	packet.narrative_key = "wallet_mutated"
	packet.narrative_args = [currency_type, new_amt - old_amt]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)

## 8. v2：全量快照广播（整型信道 + 池化借还闭环）
static func publish_hud_snapshot_v2(snapshot: HudStatusSnapshotDTO) -> void:
	if snapshot == null:
		return
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.HUD_STATUS_SNAPSHOT, EventCategoryMask.CORE_STATE)
	packet.payload_dto = snapshot
	packet.narrative_key = "snapshot_published"
	packet.narrative_args = [snapshot.character_name]
	bus.dispatch_now(packet)
	bus.recycle_packet(packet)
