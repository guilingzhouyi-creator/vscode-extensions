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
	var health_points: float = 100.0
	var max_health_points: float = 100.0
	var action_points: int = 0
	var weapon_mass_kg: float = 2.5
	var weapon_velocity: float = 6.0
	var edge_sharpness: float = 1.2
	var armor_rating: float = 5.0
	var is_staggered: bool = false
	var is_monster: bool = false

static var _defaults_cache: CombatParticipantDefaults = null
static var _defaults_config_version: int = -1
static var _is_event_pools_bound: bool = false
static var _event_ensure_callback: Callable = Callable()
static var _event_acquire_callback: Callable = Callable()
static var _event_release_callback: Callable = Callable()
static var _local_event_pool: Array[PhysicalVerbRegistry.CombatNarrativeEventPacket] = []

static func _ensure_participant_defaults() -> CombatParticipantDefaults:
	var config_version: int = GameConfig.config_reload_version()
	if _defaults_cache != null and _defaults_config_version == config_version:
		return _defaults_cache
	var defaults := CombatParticipantDefaults.new()
	defaults.name = GameConfig.get_string("domains.combat", "participant_defaults/name", "战士")
	defaults.health_points = GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)
	defaults.max_health_points = GameConfig.get_float("domains.combat", "participant_defaults/max_hp", 100.0)
	defaults.action_points = GameConfig.get_int("domains.combat", "participant_defaults/ap", 0)
	defaults.weapon_mass_kg = GameConfig.get_float("domains.combat", "participant_defaults/weapon_mass_kg", 2.5)
	defaults.weapon_velocity = GameConfig.get_float("domains.combat", "participant_defaults/weapon_velocity", 6.0)
	defaults.edge_sharpness = GameConfig.get_float("domains.combat", "participant_defaults/edge_sharpness", 1.2)
	defaults.armor_rating = GameConfig.get_float("domains.combat", "participant_defaults/armor_rating", 5.0)
	defaults.is_staggered = GameConfig.get_bool("domains.combat", "participant_defaults/is_staggered", false)
	defaults.is_monster = GameConfig.get_bool("domains.combat", "participant_defaults/is_monster", false)
	_defaults_cache = defaults
	_defaults_config_version = config_version
	return defaults

## 依赖倒置对象池端口绑定（与 infrastructure.ObjectPoolManager 对接 combat_events 池）
static func bind_event_pool_backend(ensure_callback: Callable, acquire_callback: Callable, release_callback: Callable) -> void:
	_event_ensure_callback = ensure_callback
	_event_acquire_callback = acquire_callback
	_event_release_callback = release_callback
	_is_event_pools_bound = false

static func _ensure_event_pool() -> void:
	if _is_event_pools_bound:
		return
	if _event_ensure_callback.is_valid():
		_event_ensure_callback.call(POOL_COMBAT_EVENTS, func() -> RefCounted:
			return PhysicalVerbRegistry.CombatNarrativeEventPacket.new()
		)
	_is_event_pools_bound = true

## 从对象池借出战斗叙事事件包（无配置注入时回退本地有界池）
static func borrow_combat_event() -> PhysicalVerbRegistry.CombatNarrativeEventPacket:
	_ensure_event_pool()
	if _event_acquire_callback.is_valid():
		var pooled: PhysicalVerbRegistry.CombatNarrativeEventPacket = _event_acquire_callback.call(POOL_COMBAT_EVENTS) as PhysicalVerbRegistry.CombatNarrativeEventPacket
		if pooled != null:
			return pooled
	if not _local_event_pool.is_empty():
		var local_packet: PhysicalVerbRegistry.CombatNarrativeEventPacket = _local_event_pool.pop_back()
		if local_packet != null:
			local_packet.reset_state()
			return local_packet
	return PhysicalVerbRegistry.CombatNarrativeEventPacket.new()

## 归还战斗叙事事件包至对象池
static func recycle_combat_event(packet: PhysicalVerbRegistry.CombatNarrativeEventPacket) -> void:
	if packet == null:
		return
	_ensure_event_pool()
	if _event_release_callback.is_valid():
		_event_release_callback.call(POOL_COMBAT_EVENTS, packet)
		return
	if _local_event_pool.size() < MAX_LOCAL_COMBAT_EVENT_POOL:
		packet.reset_state()
		_local_event_pool.append(packet)

## 测试隔离：重置本地事件池与参数缓存
static func reset_pool_for_tests() -> void:
	_is_event_pools_bound = false
	_local_event_pool.clear()
	_defaults_cache = null
	_defaults_config_version = -1

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
	var is_monster: bool = false # 怪物标记（击杀掉落发射判据，配置默认回退）

	func _init() -> void:
		var defaults: CombatParticipantDefaults = CombatPipelineFSM._ensure_participant_defaults()
		name = defaults.name
		current_hp = defaults.health_points
		max_hp = defaults.max_health_points
		current_ap = defaults.action_points
		weapon_mass_kg = defaults.weapon_mass_kg
		weapon_velocity = defaults.weapon_velocity
		edge_sharpness = defaults.edge_sharpness
		armor_rating = defaults.armor_rating
		is_staggered = defaults.is_staggered
		is_monster = defaults.is_monster

## 结算参数静态缓存（模式：配置热重载版本推进自动失效重建）。
## execute_action_round 每击原本 4 次 GameConfig 路径查找（interrupt_verbs/ap_penalty/
## defense_multipliers）——缓存后每次动作仅一次版本比对 + 字段复制。
class CombatSettlementParams extends RefCounted:
	var interrupt_verbs: Array = ["PARRY", "INTER"]
	var action_points_penalty: int = 2
	var block_multiplier: float = 0.35
	var parry_multiplier: float = 0.50
	var monster_drop_ids: Array = []

static var _settlement_cache: CombatSettlementParams = null
static var _settlement_config_version: int = -1

## 结算参数缓存新鲜度守卫：未构建或配置热重载版本推进时触发重建
static func _ensure_settlement_cache() -> void:
	if _settlement_cache != null and _settlement_config_version == GameConfig.config_reload_version():
		return
	var settlement_parameters := CombatSettlementParams.new()
	settlement_parameters.interrupt_verbs = GameConfig.get_array("domains.combat", "interrupt_verbs", ["PARRY", "INTER"])
	settlement_parameters.action_points_penalty = GameConfig.get_int("domains.combat", "interrupt/ap_penalty", 2)
	settlement_parameters.block_multiplier = GameConfig.get_float("domains.combat", "defense_multipliers/block", 0.35)
	settlement_parameters.parry_multiplier = GameConfig.get_float("domains.combat", "defense_multipliers/parry", 0.50)
	settlement_parameters.monster_drop_ids = GameConfig.get_array("domains.monster", "loot/default_drop_canonical_ids", [])
	_settlement_cache = settlement_parameters
	_settlement_config_version = GameConfig.config_reload_version()

## 推进并结算当前动作轮次的所有参战行为（支持传入复用的 output_packet 避免堆分配）
static func execute_action_round(
	attacker: CombatParticipant,
	attacker_verb: String,
	defender: CombatParticipant,
	defender_verb: String,
	output_packet: PhysicalVerbRegistry.CombatNarrativeEventPacket = null
) -> PhysicalVerbRegistry.CombatNarrativeEventPacket:
	var packet: PhysicalVerbRegistry.CombatNarrativeEventPacket = output_packet
	if packet != null:
		packet.reset_state()
	else:
		packet = PhysicalVerbRegistry.CombatNarrativeEventPacket.new()
	packet.actor_id = attacker.participant_id
	packet.target_id = defender.participant_id

	var attacker_verb_definition: Variant = PhysicalVerbRegistry.get_verb(attacker_verb)
	var defender_verb_definition: Variant = PhysicalVerbRegistry.get_verb(defender_verb)

	attacker.current_ap += int(attacker_verb_definition.get("base_ap", 0))
	defender.current_ap += int(defender_verb_definition.get("base_ap", 0))

	# 打断与防反判定: 若防守方使用 PARRY/INTER 且当前处于蓄力拦截窗口，判定打断
	_ensure_settlement_cache()
	var settlement_parameters := _settlement_cache
	var is_interrupted := false
	if defender_verb in settlement_parameters.interrupt_verbs and attacker.current_ap < 0:
		is_interrupted = true
		attacker.is_staggered = true
		attacker.current_ap -= settlement_parameters.action_points_penalty # 额外失衡惩罚
		packet.is_interrupted = true
		packet.narrative_text = EventBusCore.render_narrative("combat/parry_interrupt", [
			defender.name, defender_verb_definition.name, attacker.name, attacker_verb_definition.name
		])
	else:
		var raw_damage: Variant = PhysicsAndThermodynamicsSolver.calculate_penetration_damage(
			attacker.weapon_mass_kg,
			attacker.weapon_velocity,
			attacker_verb,
			attacker.edge_sharpness,
			defender.armor_rating
		)

		# 防御姿态减伤
		var defense_multiplier := 1.0
		if defender_verb == "BLOCK":
			defense_multiplier = settlement_parameters.block_multiplier
		elif defender_verb == "PARRY":
			defense_multiplier = settlement_parameters.parry_multiplier

		var final_damage: float = raw_damage * defense_multiplier
		defender.current_hp = maxf(0.0, defender.current_hp - final_damage)

		packet.raw_damage = raw_damage
		packet.absorbed_damage = raw_damage - final_damage
		packet.final_damage = final_damage
		packet.narrative_text = EventBusCore.render_narrative("combat/strike_hit", [
			attacker.name, attacker_verb_definition.name, final_damage, defender.name, defender.current_hp
		])

		# 怪物阵亡 → 发射 monster.killed（掉落声明由监听器登记为活跃掉落物）
		if defender.current_hp <= 0.0 and defender.is_monster:
			_emit_monster_killed(attacker, defender)

	EventBusCore.get_instance().emit_narrative(packet.narrative_text, "combat", {
		"raw_damage": packet.raw_damage,
		"final_damage": packet.final_damage,
		"interrupted": packet.is_interrupted
	})
	return packet

## 击杀发射：读 domains.monster loot/default_drop_canonical_ids，
## 逐项经 catalog 校验后组 drop_declarations 发射 monster.killed；
## 未装配/未登记项安全跳过（零无效掉落声明）。
static func _emit_monster_killed(attacker: CombatParticipant, defender: CombatParticipant) -> void:
	_ensure_settlement_cache()
	var drop_ids: Array = _settlement_cache.monster_drop_ids
	var declarations: Array = []
	if drop_ids.is_empty() or not GameBootstrap.is_assembled():
		return
	var catalog := GameBootstrap.catalog()
	for drop_id in drop_ids:
		var canonical_id := str(drop_id)
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
		"category_key": "combat",
		"killer_id": attacker.participant_id,
		"victim_id": defender.participant_id,
		"drop_declarations": declarations,
	})
