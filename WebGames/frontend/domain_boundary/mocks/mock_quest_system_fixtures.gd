# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_quest_system_fixtures.gd
# 架构定位: Quest, Notification & System Save Mock Fixture Module
# 依赖与触发: 上游: MockDataCatalog | 下游: 无（静态演示数据真源）
# 职责说明: 提供任务因果链、通知公告与系统存档域的静态模拟夹具。
# 退出语义与设计依据: 模拟数据单一真源与按域模块化拆分契约
# ==============================================================================

## 任务因果链、通知公告与系统存档域静态模拟数据集
extends RefCounted

static func _quest(qid: String, slug: String, cat: String, status: String, req: int, obj_n: int, rwd_n: int) -> Dictionary:
	var p := "ui.fe07.mock.quest." + slug
	var objectives: Array = []
	for i in range(1, obj_n + 1):
		objectives.append(p + ".obj" + str(i))
	var rewards: Array = []
	for i in range(1, rwd_n + 1):
		rewards.append(p + ".rwd" + str(i))
	return {
		"quest_id": qid,
		"title": p + ".title",
		"category": cat,
		"status": status,
		"giver": p + ".giver",
		"level_req": req,
		"desc": p + ".desc",
		"objectives": objectives,
		"rewards": rewards,
	}

static func _bounty(tid: String, slug: String, tier: int, gold: int) -> Dictionary:
	var p := "ui.fe07.mock.bounty." + slug
	return {
		"target_id": tid,
		"name": p + ".name",
		"tier": tier,
		"reward_gold": gold,
		"time_remain": p + ".time",
		"desc": p + ".desc",
	}

static func _dag(nid: String, slug: String, status: String) -> Dictionary:
	var p := "ui.fe07.mock.dag." + slug
	return {"node_id": nid, "name": p + ".name", "status": status, "chain_desc": p + ".chain_desc"}

static func _notice(id: String, slug: String, cat: int, time_str: String, is_read: bool, jump: String) -> Dictionary:
	var p := "ui.fe14.notification.mock." + slug
	return {
		"id": id,
		"category": cat,
		"title_key": p + ".title",
		"content_key": p + ".content",
		"time": time_str,
		"read": is_read,
		"jump_target": jump,
	}

## 构建主线/支线/委托任务与悬赏、DAG 节点模拟数据
static func build_quest_data() -> Dictionary:
	return {
		"quests": [
			_quest("Q_MAIN_01", "q_main_01", "MAIN", "ACTIVE", 20, 2, 3),
			_quest("Q_MAIN_02", "q_main_02", "MAIN", "AVAILABLE", 15, 2, 2),
			_quest("Q_SIDE_01", "q_side_01", "SIDE", "ACTIVE", 5, 1, 2),
			_quest("Q_SIDE_02", "q_side_02", "SIDE", "AVAILABLE", 8, 2, 2),
			_quest("Q_COM_01", "q_com_01", "COMMISSION", "COMPLETED", 10, 1, 1),
			_quest("Q_COM_02", "q_com_02", "COMMISSION", "ACTIVE", 12, 1, 2),
		],
		"dag_nodes": [
			_dag("DAG_01", "dag_01", "COMPLETED"),
			_dag("DAG_02", "dag_02", "COMPLETED"),
			_dag("DAG_03", "dag_03", "ACTIVE"),
			_dag("DAG_04", "dag_04", "ACTIVE"),
			_dag("DAG_05", "dag_05", "LOCKED"),
			_dag("DAG_06", "dag_06", "LOCKED"),
			_dag("DAG_07", "dag_07", "LOCKED"),
		],
		"bounty_targets": [
			_bounty("B_T1_01", "b_t1_01", 1, 500),
			_bounty("B_T2_01", "b_t2_01", 2, 1500),
			_bounty("B_T2_02", "b_t2_02", 2, 2000),
			_bounty("B_T3_01", "b_t3_01", 3, 5000),
			_bounty("B_T4_01", "b_t4_01", 4, 12000),
			_bounty("B_T5_01", "b_t5_01", 5, 50000),
			_bounty("B_T5_02", "b_t5_02", 5, 80000),
		],
	}

## 构建系统通知与公告列表模拟数据
static func build_notification_data() -> Dictionary:
	var bp := "ui.fe14.bulletin.mock."
	return {
		"notifications": [
			_notice("N001", "n001", 0, "09-01 10:00", false, ""),
			_notice("N002", "n002", 1, "09-01 09:32", false, "world_map"),
			_notice("N003", "n003", 2, "09-01 08:15", false, "guild_social"),
			_notice("N004", "n004", 3, "09-01 06:00", true, "quest_causality"),
			_notice("N005", "n005", 4, "08-31 23:59", true, ""),
			_notice("N006", "n006", 5, "08-31 20:30", true, "character_progression"),
		],
		"bulletins": [
			{"id": "B001", "category": 0, "title_key": bp + "b001.title", "priority": 1, "time": "09-01 00:00", "content_key": bp + "b001.content"},
			{"id": "B002", "category": 1, "title_key": bp + "b002.title", "priority": 0, "time": "08-31 18:00", "content_key": bp + "b002.content"},
			{"id": "B003", "category": 2, "title_key": bp + "b003.title", "priority": 2, "time": "08-30 14:00", "content_key": bp + "b003.content"},
			{"id": "B004", "category": 3, "title_key": bp + "b004.title", "priority": 1, "time": "08-28 10:00", "content_key": bp + "b004.content"},
		],
	}

## 构建系统存档槽位与兑换码历史模拟数据
static func build_system_save_data() -> Dictionary:
	return {
		"save_slots": [
			{"slot_id": "SLOT_01", "char_name_key": "ui.fe16.mock.char.artoria", "level": 45, "playtime_sec": 86400, "save_date": "2026-08-31 23:15", "empty": false},
			{"slot_id": "SLOT_02", "char_name_key": "ui.fe16.mock.char.meriel", "level": 32, "playtime_sec": 43200, "save_date": "2026-08-30 18:42", "empty": false},
			{"slot_id": "SLOT_03", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_04", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_05", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
			{"slot_id": "SLOT_06", "char_name_key": "", "level": 0, "playtime_sec": 0, "save_date": "", "empty": true},
		],
		"cdkey_history": [
			{"code": "WELCOME2026", "reward_key": "ui.fe16.mock.cdkey.gold_10000", "time": "2026-08-28 10:00", "success": true},
			{"code": "SUMMER_GIFT", "reward_key": "ui.fe16.mock.cdkey.summer_outfit", "time": "2026-08-15 14:30", "success": true},
		],
	}
