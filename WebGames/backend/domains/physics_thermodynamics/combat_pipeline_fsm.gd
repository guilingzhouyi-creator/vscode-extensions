# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/physics_thermodynamics/combat_pipeline_fsm.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/combat.json | 信号: EventBus 领域广播
# 职责说明: 正负 AP 动态势能博弈、防反架招打断/僵直状态机与战报文字流生成。 参与者默认属性、打断惩罚、减伤系数与叙事文案由 config/domains/combat.json、 config/narratives/combat.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## CombatPipelineFSM：Business Pipeline / Transaction Safe Orchestrator
class_name CombatPipelineFSM extends RefCounted

const POOL_COMBAT_EVENTS: String = "combat_events"
const MAX_LOCAL_COMBAT_EVENT_POOL: int = 256

class CombatParticipantDefaults extends RefCounted:
	var name: String = "战士"
	var hp: float = 100.0
	var max_hp: float = 100.0
	var ap: int = 0
	var weapon_mass_kg: float = 2.5
	var weapon_velocity: float = 6.0
	var edge_sharpness: float = 1.2
	var armor_rating: float = 5.0
	var is_staggered: bool = false
	var is_monster: bool = false

static var _defaults_cache: CombatParticipantDefaults = null
static var _defaults_cfg_version: int = -1
static var _event_pools_bound: bool = false
static var _event_ensure_cb: Callable = Callable()
static var _event_acquire_cb: Callable = Callable()
static var _event_release_cb: Callable = Callable()
static var _local_event_pool: Array[PhysicalVerbRegistry.CombatNarrativeEventPacket] = []

static func _ensure_participant_defaults() -> CombatParticipantDefaults:
	var cfg_ver: int = GameConfig.config_reload_version()
	if _defaults_cache != null and _defaults_cfg_version == cfg_ver:
		return _defaults_cache
	var d := CombatParticipantDefaults.new()
	d.name = GameConfig.get_string("domains.combat", "participant_defaults/name", "战士")
	d.hp = GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)
	d.max_hp = GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0)
	d.ap = GameConfig.get_int("domains.combat", "participant_defaults/ap", 0)
	d.weapon_mass_kg = GameConfig.get_float("domains.combat", "participant_defaults/weapon_mass_kg", 2.5)
	d.weapon_velocity = GameConfig.get_float("domains.combat", "participant_defaults/weapon_velocity", 6.0)
	d.edge_sharpness = GameConfig.get_float("domains.combat", "participant_defaults/edge_sharpness", 1.2)
	d.armor_rating = GameConfig.get_float("domains.combat", "participant_defaults/armor_rating", 5.0)
	d.is_staggered = GameConfig.get_bool("domains.combat", "participant_defaults/is_staggered", false)
	d.is_monster = GameConfig.get_bool("domains.combat", "participant_defaults/is_monster", false)
	_defaults_cache = d
	_defaults_cfg_version = cfg_ver
	return d

## 依赖倒置对象池端口绑定（与 infrastructure.ObjectPoolManager 对接 combat_events 池）
static func bind_event_pool_backend(ensure_cb: Callable, acquire_cb: Callable, release_cb: Callable) -> void:
	_event_ensure_cb = ensure_cb
	_event_acquire_cb = acquire_cb
	_event_release_cb = release_cb
	_event_pools_bound = false

static func _ensure_event_pool() -> void:
	if _event_pools_bound:
		return
	if _event_ensure_cb.is_valid():
		_event_ensure_cb.call(POOL_COMBAT_EVENTS, func() -> RefCounted:
			return PhysicalVerbRegistry.CombatNarrativeEventPacket.new()
		)
	_event_pools_bound = true

## 从对象池借出战斗叙事事件包（无配置注入时回退本地有界池）
static func borrow_combat_event() -> PhysicalVerbRegistry.CombatNarrativeEventPacket:
	_ensure_event_pool()
	if _event_acquire_cb.is_valid():
		var pooled: PhysicalVerbRegistry.CombatNarrativeEventPacket = _event_acquire_cb.call(POOL_COMBAT_EVENTS) as PhysicalVerbRegistry.CombatNarrativeEventPacket
		if pooled != null:
			return pooled
	if not _local_event_pool.is_empty():
		var local_pkt: PhysicalVerbRegistry.CombatNarrativeEventPacket = _local_event_pool.pop_back()
		if local_pkt != null:
			local_pkt.reset_state()
			return local_pkt
	return PhysicalVerbRegistry.CombatNarrativeEventPacket.new()

## 归还战斗叙事事件包至对象池
static func recycle_combat_event(packet: PhysicalVerbRegistry.CombatNarrativeEventPacket) -> void:
	if packet == null:
		return
	_ensure_event_pool()
	if _event_release_cb.is_valid():
		_event_release_cb.call(POOL_COMBAT_EVENTS, packet)
		return
	if _local_event_pool.size() < MAX_LOCAL_COMBAT_EVENT_POOL:
		packet.reset_state()
		_local_event_pool.append(packet)

## 测试隔离：重置本地事件池与参数缓存
static func reset_pool_for_tests() -> void:
	_event_pools_bound = false
	_local_event_pool.clear()
	_defaults_cache = null
	_defaults_cfg_version = -1

## CombatParticipant：战斗参战单位实体模型
class CombatParticipant extends RefCounted:
	var participant_id: String = ""
	var name: String = "战士"
	var current_hp: float = 100.0
	var max_hp: float = 100.0
	var current_ap: int = 0 # 正负 AP 动态势能轴
	var weapon_mass_kg: float = 2.5
	var weapon_velocity: float = 6.0
	var edge_sharpness: float = 1.2
	var armor_rating: float = 5.0
	var is_staggered: bool = false
	var is_monster: bool = false # N2：怪物标记（击杀掉落发射判据，配置兜底）

	func _init() -> void:
		var d: CombatParticipantDefaults = CombatPipelineFSM._ensure_participant_defaults()
		name = d.name
		current_hp = d.hp
		max_hp = d.max_hp
		current_ap = d.ap
		weapon_mass_kg = d.weapon_mass_kg
		weapon_velocity = d.weapon_velocity
		edge_sharpness = d.edge_sharpness
		armor_rating = d.armor_rating
		is_staggered = d.is_staggered
		is_monster = d.is_monster

## 结算参数静态缓存（模式：配置热重载版本推进自动失效重建）。
## execute_action_round 每击原本 4 次 GameConfig 路径查找（interrupt_verbs/ap_penalty/
## defense_multipliers）——缓存后每次动作仅一次版本比对 + 字段复制。
class CombatSettlementParams extends RefCounted:
	var interrupt_verbs: Array = ["PARRY", "INTER"]
	var ap_penalty: int = 2
	var block_mult: float = 0.35
	var parry_mult: float = 0.50
	var monster_drop_ids: Array = []

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
	p.monster_drop_ids = GameConfig.get_array("domains.monster", "loot/default_drop_canonical_ids", [])
	_settlement_cache = p
	_settlement_config_version = GameConfig.config_reload_version()

## 推进并结算当前动作轮次的所有参战行为（支持传入复用的 out_packet 避免堆分配）
static func execute_action_round(
	attacker: CombatParticipant,
	attacker_verb: String,
	defender: CombatParticipant,
	defender_verb: String,
	out_packet: PhysicalVerbRegistry.CombatNarrativeEventPacket = null
) -> PhysicalVerbRegistry.CombatNarrativeEventPacket:
	var packet: PhysicalVerbRegistry.CombatNarrativeEventPacket = out_packet
	if packet != null:
		packet.reset_state()
	else:
		packet = PhysicalVerbRegistry.CombatNarrativeEventPacket.new()
	packet.actor_id = attacker.participant_id
	packet.target_id = defender.participant_id

	var a_verb_info: Variant = PhysicalVerbRegistry.get_verb(attacker_verb)
	var d_verb_info: Variant = PhysicalVerbRegistry.get_verb(defender_verb)

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
		var raw_dmg: Variant = PhysicsAndThermodynamicsSolver.calculate_penetration_damage(
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

		var final_dmg: float = raw_dmg * defense_mult
		defender.current_hp = maxf(0.0, defender.current_hp - final_dmg)

		packet.raw_damage = raw_dmg
		packet.absorbed_damage = raw_dmg - final_dmg
		packet.final_damage = final_dmg
		packet.narrative_text = EventBusCore.render_narrative("combat/strike_hit", [
			attacker.name, a_verb_info.name, final_dmg, defender.name, defender.current_hp
		])

		# N2：怪物阵亡 → 发射 monster.killed（掉落声明由监听器登记为活跃掉落物）
		if defender.current_hp <= 0.0 and defender.is_monster:
			_emit_monster_killed(attacker, defender)

	EventBusCore.get_instance().emit_narrative(packet.narrative_text, "combat", {
		"raw_damage": packet.raw_damage,
		"final_damage": packet.final_damage,
		"interrupted": packet.is_interrupted
	})
	return packet

## N2：击杀发射——读 domains.monster loot/default_drop_canonical_ids，
## 逐项经 catalog 校验后组 drop_declarations 发射 monster.killed；
## 未装配/未登记项安全跳过（零无效掉落声明）。
static func _emit_monster_killed(attacker: CombatParticipant, defender: CombatParticipant) -> void:
	_ensure_settlement_cache()
	var drop_ids: Array = _settlement_cache.monster_drop_ids
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
