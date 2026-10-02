# ==============================================================================
# 模块归属: 测试与工程化工具层 (Dev Harness · 快照测试工程模式)
# 文件路径: res://dev_harness/snapshot_mode/snapshot_catalog.gd
# 架构定位: Test Fixture Catalog / Predefined Preset Library
# 跨域依赖: 上游: SnapshotInjectionSolver, 测试套件 | 下游: TestSnapshotBundleDTO
# 职责说明: 提供全域工业级预置测试快照模版，覆盖初生、进阶、终局全装与极限战斗态
# 设计依据: 业务域第一性原理 / 快照测试工程化规范
# ==============================================================================
class_name SnapshotCatalog
extends RefCounted

const TestSnapshotBundleDTO = preload("res://dev_harness/snapshot_mode/dto/test_snapshot_bundle_dto.gd")

## 1. 初生态快照（序章刚结束，白板新手装备，基础货币）
static func fixture_novice_spawned() -> TestSnapshotBundleDTO:
	var snap := TestSnapshotBundleDTO.new()
	snap.snapshot_id = "FIXTURE_NOVICE_SPAWNED"
	snap.description = "序章刚结束初生态：新手白板装备与初始资产"
	snap.target_stage_key = "STAGE_06_HUD_SYNC"
	snap.account_id = "ACC_NOVICE_01"
	snap.username = "NoviceRunner"
	snap.character_id = "CHAR_NOVICE_01"
	snap.character_name = "NoviceRunner"
	snap.race_id = "HUMAN"
	snap.gender = "MALE"
	snap.level = 1
	snap.wallet_data = {"copper": 50, "silver": 5, "gold": 100, "mana_monocrystals": 0}
	snap.physiology_data = {
		"current_hp": 100, "max_hp": 100, "current_mp": 50, "max_mp": 50,
		"stamina": 100, "sanity": 100, "hunger": 0, "thirst": 0
	}
	snap.location_name = "CENTRAL_CITY_PLAZA"
	snap.inventory_items = [
		{"item_uid": "ITEM_NOVICE_SWORD_01", "template_id": "novice_iron_sword", "count": 1}
	]
	return snap

## 2. 进阶态快照（25级精灵族，精良装备与魔法资源，主城枢纽）
static func fixture_mid_explorer() -> TestSnapshotBundleDTO:
	var snap := TestSnapshotBundleDTO.new()
	snap.snapshot_id = "FIXTURE_MID_EXPLORER"
	snap.description = "进阶探索者：25级精灵族，精良装备与充沛魔力"
	snap.target_stage_key = "STAGE_06_HUD_SYNC"
	snap.account_id = "ACC_MID_01"
	snap.username = "SylphExplorer"
	snap.character_id = "CHAR_MID_01"
	snap.character_name = "SylphExplorer"
	snap.race_id = "ELF"
	snap.gender = "FEMALE"
	snap.level = 25
	snap.attributes = {
		"strength": 4, "agility": 5, "physique": 3,
		"intelligence": 5, "willpower": 4, "perception": 4
	}
	snap.wallet_data = {"copper": 200, "silver": 50, "gold": 5000, "mana_monocrystals": 25}
	snap.physiology_data = {
		"current_hp": 320, "max_hp": 320, "current_mp": 240, "max_mp": 240,
		"stamina": 180, "sanity": 95, "hunger": 10, "thirst": 5
	}
	snap.location_name = "ELVEN_SANCTUARY_SANCTUM"
	snap.inventory_items = [
		{"item_uid": "ITEM_ELVEN_BOW_01", "template_id": "elven_wind_bow", "count": 1, "tier": "RARE"},
		{"item_uid": "ITEM_MANA_POTION_01", "template_id": "pure_mana_vial", "count": 5}
	]
	return snap

## 3. 终局态快照（60级满装英雄，史诗装备与战略魔单晶，通关特定因果）
static func fixture_late_hero() -> TestSnapshotBundleDTO:
	var snap := TestSnapshotBundleDTO.new()
	snap.snapshot_id = "FIXTURE_LATE_HERO"
	snap.description = "终局英雄态：满级神装，海量战略魔单晶"
	snap.target_stage_key = "STAGE_06_HUD_SYNC"
	snap.account_id = "ACC_HERO_01"
	snap.username = "GrandChampion"
	snap.character_id = "CHAR_HERO_01"
	snap.character_name = "GrandChampion"
	snap.race_id = "HUMAN"
	snap.gender = "MALE"
	snap.level = 60
	snap.attributes = {
		"strength": 6, "agility": 6, "physique": 6,
		"intelligence": 6, "willpower": 6, "perception": 6
	}
	snap.wallet_data = {"copper": 0, "silver": 0, "gold": 88888, "mana_monocrystals": 200}
	snap.physiology_data = {
		"current_hp": 1200, "max_hp": 1200, "current_mp": 800, "max_mp": 800,
		"stamina": 500, "sanity": 100, "hunger": 0, "thirst": 0
	}
	snap.location_name = "HOLY_CITADEL_THRONE"
	snap.inventory_items = [
		{"item_uid": "ITEM_EXCALIBUR_01", "template_id": "holy_avenger", "count": 1, "tier": "EPIC"}
	]
	snap.quest_dag_state = {
		"active_quests": [],
		"completed_quests": ["MAIN_QUEST_FINAL_EPIC"],
		"activated_nodes": ["NODE_WORLD_PEACE"]
	}
	return snap

## 4. 极限战斗态（残血 5%，魔力枯竭，重伤状态，地牢战场）
static func fixture_combat_critical() -> TestSnapshotBundleDTO:
	var snap := TestSnapshotBundleDTO.new()
	snap.snapshot_id = "FIXTURE_COMBAT_CRITICAL"
	snap.description = "极限残血测试态：生命濒危，魔力见底，检验应急状态与战备逃生"
	snap.target_stage_key = "STAGE_06_HUD_SYNC"
	snap.account_id = "ACC_CRIT_01"
	snap.username = "DesperateSurvivor"
	snap.character_id = "CHAR_CRIT_01"
	snap.character_name = "DesperateSurvivor"
	snap.race_id = "HUMAN"
	snap.gender = "MALE"
	snap.level = 15
	snap.wallet_data = {"copper": 10, "silver": 0, "gold": 50, "mana_monocrystals": 1}
	snap.physiology_data = {
		"current_hp": 5, "max_hp": 200, "current_mp": 0, "max_mp": 100,
		"stamina": 10, "sanity": 25, "hunger": 85, "thirst": 90,
		"status_effects": ["POISONED", "EXHAUSTED"]
	}
	snap.location_name = "ABYSSAL_DUNGEON_DEPTHS"
	return snap

