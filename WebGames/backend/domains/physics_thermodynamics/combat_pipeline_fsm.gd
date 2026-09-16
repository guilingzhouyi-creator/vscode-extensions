# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_pipeline_fsm.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 正负 AP 动态势能博弈、防反架招打断/僵直状态机与战报文字流生成。 参与者默认属性、打断惩罚、减伤系数与叙事文案由 config/domains/combat.json、 config/narratives/combat.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CombatPipelineFSM extends RefCounted

class CombatParticipant extends RefCounted:
	var participant_id: String = ""
	var name: String = GameConfig.get_string("domains.combat", "participant_defaults/name", "战士")
	var current_hp: float = GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)
	var max_hp: float = GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0)
	var current_ap: int = GameConfig.get_int("domains.combat", "participant_defaults/ap", 0) # 正负 AP 动态势能轴
	var weapon_mass_kg: float = GameConfig.get_float("domains.combat", "participant_defaults/weapon_mass_kg", 2.5)
	var weapon_velocity: float = GameConfig.get_float("domains.combat", "participant_defaults/weapon_velocity", 6.0)
	var edge_sharpness: float = GameConfig.get_float("domains.combat", "participant_defaults/edge_sharpness", 1.2)
	var armor_rating: float = GameConfig.get_float("domains.combat", "participant_defaults/armor_rating", 5.0)
	var is_staggered: bool = GameConfig.get_bool("domains.combat", "participant_defaults/is_staggered", false)
	var is_monster: bool = GameConfig.get_bool("domains.combat", "participant_defaults/is_monster", false) # Phase 43 N2：怪物标记（击杀掉落发射判据，配置兜底）

## 结算参数静态缓存（Phase 64 P2 模式：配置热重载版本推进自动失效重建）。
## execute_action_round 每击原本 4 次 GameConfig 路径查找（interrupt_verbs/ap_penalty/
## defense_multipliers）——缓存后每次动作仅一次版本比对 + 字段复制。
class CombatSettlementParams extends RefCounted:
	var interrupt_verbs: Array = ["PARRY", "INTER"]
	var ap_penalty: int = 2
	var block_mult: float = 0.35
	var parry_mult: float = 0.50

static var _settlement_cache: CombatSettlementParams = null
static var _settlement_config_version: int = -1

## 结算参数缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_settlement_cache() -> void:
	if _settlement_cache != null and _settlement_config_version == GameConfig.config_reload_version():
		return
	var p := CombatSettlementParams.new()
	p.interrupt_verbs = GameConfig.get_array("domains.combat", "interrupt_verbs", ["PARRY", "INTER"])
	p.ap_penalty = GameConfig.get_int("domains.combat", "interrupt/ap_penalty", 2)
	p.block_mult = GameConfig.get_float("domains.combat", "defense_multipliers/block", 0.35)
	p.parry_mult = GameConfig.get_float("domains.combat", "defense_multipliers/parry", 0.50)
	_settlement_cache = p
	_settlement_config_version = GameConfig.config_reload_version()

static func execute_action_round(
	attacker: CombatParticipant,
	attacker_verb: String,
	defender: CombatParticipant,
	defender_verb: String
) -> PhysicalVerbRegistry.CombatNarrativeEventPacket:
	var packet := PhysicalVerbRegistry.CombatNarrativeEventPacket.new()
	packet.actor_id = attacker.participant_id
	packet.target_id = defender.participant_id

	var a_verb_info = PhysicalVerbRegistry.get_verb(attacker_verb)
	var d_verb_info = PhysicalVerbRegistry.get_verb(defender_verb)

	attacker.current_ap += int(a_verb_info.get("base_ap", 0))
	defender.current_ap += int(d_verb_info.get("base_ap", 0))

	# 打断与防反判定: 若防守方使用 PARRY/INTER 且当前处于蓄力拦截窗口，判定打断
	_ensure_settlement_cache()
	var p := _settlement_cache
	var is_interrupted := false
	if defender_verb in p.interrupt_verbs and attacker.current_ap < 0:
		is_interrupted = true
		attacker.is_staggered = true
		attacker.current_ap -= p.ap_penalty # 额外失衡惩罚
		packet.is_interrupted = true
		packet.narrative_text = EventBusCore.render_narrative("combat/parry_interrupt", [
			defender.name, d_verb_info.name, attacker.name, a_verb_info.name
		])
	else:
		var raw_dmg = PhysicsAndThermodynamicsSolver.calculate_penetration_damage(
			attacker.weapon_mass_kg,
			attacker.weapon_velocity,
			attacker_verb,
			attacker.edge_sharpness,
			defender.armor_rating
		)

		# 防御姿态减伤
		var defense_mult := 1.0
		if defender_verb == "BLOCK":
			defense_mult = p.block_mult
		elif defender_verb == "PARRY":
			defense_mult = p.parry_mult

		var final_dmg = raw_dmg * defense_mult
		defender.current_hp = max(0.0, defender.current_hp - final_dmg)

		packet.raw_damage = raw_dmg
		packet.absorbed_damage = raw_dmg - final_dmg
		packet.final_damage = final_dmg
		packet.narrative_text = EventBusCore.render_narrative("combat/strike_hit", [
			attacker.name, a_verb_info.name, final_dmg, defender.name, defender.current_hp
		])

		# Phase 43 N2：怪物阵亡 → 发射 monster.killed（掉落声明由监听器登记为活跃掉落物）
		if defender.current_hp <= 0.0 and defender.is_monster:
			_emit_monster_killed(attacker, defender)

	EventBusCore.get_instance().emit_narrative(packet.narrative_text, "combat", {
		"raw_damage": packet.raw_damage,
		"final_damage": packet.final_damage,
		"interrupted": packet.is_interrupted
	})
	return packet

## Phase 43 N2：击杀发射——读 domains.monster loot/default_drop_canonical_ids，
## 逐项经 catalog 校验后组 drop_declarations 发射 monster.killed；
## 未装配/未登记项安全跳过（零无效掉落声明）。
static func _emit_monster_killed(attacker: CombatParticipant, defender: CombatParticipant) -> void:
	var drop_ids: Array = GameConfig.get_array("domains.monster", "loot/default_drop_canonical_ids", [])
	var declarations: Array = []
	if drop_ids.is_empty() or not GameBootstrap.is_assembled():
		return
	var catalog := GameBootstrap.catalog()
	for cid in drop_ids:
		var canonical_id := str(cid)
		if catalog.get_prototype(canonical_id) == null:
			continue
		declarations.append({
			"canonical_id": canonical_id,
			"display_name": canonical_id,
			"killer_id": attacker.participant_id,
		})
	if declarations.is_empty():
		return
	EventBusCore.get_instance().emit_domain_event("monster.killed", {
		"killer_id": attacker.participant_id,
		"victim_id": defender.participant_id,
		"drop_declarations": declarations,
	})
