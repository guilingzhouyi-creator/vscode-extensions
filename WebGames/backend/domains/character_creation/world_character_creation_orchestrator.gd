# ==============================================================================
# 模块归属: 业务领域层 (Domains · 角色创建领域)
# 文件路径: res://backend/domains/character_creation/world_character_creation_orchestrator.gd
# 架构定位: Domain Orchestrator / Service Facade
# 依赖与触发: 上游: WorldGatewayFSM, UI/API | 下游: WorldArchiveRepository, SaveDataAccessLayer, AccountRepository, EventBusCore | 配置: config/domains/character_creation.json | 信号: character_creation.authoritative_completed
# 职责说明: 世界内角色权威创建与时空装配事务门面。执行零信任输入防伪校验、后端权威命途解算、角色实体装配、初始装备物理入包水化、世界时钟因果锚定与历史片段只增追加、存储物理落盘与账号封面同步、网关状态自动回挂跃迁以及全景只读呈现信封组装。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## WorldCharacterCreationOrchestrator：Domain Orchestrator / Service Facade
class_name WorldCharacterCreationOrchestrator
extends RefCounted

## 非法字符黑名单（防止文件注入与控制符号破坏）
const FORBIDDEN_CHARS: Array[String] = [
    "/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\n", "\r", "\t"
]

# ==============================================================================
# 一、主事务执行入口 (create_character_authoritative)
# ==============================================================================

## 世界内角色权威创建装配主流程
## 执行防伪检验、权威解算、实体装配、物资水化、世界历史追加、物理落盘与网关回挂
static func create_character_authoritative(
    req: AuthoritativeCharacterCreationRequestDTO,
    gateway_fsm: WorldGatewayFSM = null,
    adapted_mod_manifest: Dictionary = {}
) -> Dictionary:
    # 1. 输入防伪卫语句核验
    var val_res := _validate_request(req)
    if not bool(val_res.get("valid", false)):
        return {
            "success": false,
            "error_code": str(val_res.get("error_code", "")),
            "message": str(val_res.get("message", ""))
        }
    var char_name: String = str(val_res.get("character_name", ""))

    # 2. 世界存在性核验（不存在则立即阻断）
    var world_repo := WorldArchiveRepository.get_instance()
    if not world_repo.has_world(req.world_id):
        return {
            "success": false,
            "error_code": "WORLD_NOT_FOUND",
            "message": GameConfig.msg_fmt("character_creation", "world_not_found", {"world_id": req.world_id})
        }

    # 3. 权威命途解算（零信任剥离客户端伪造参数，支持单机已预检MOD合并清单）
    var effective_manifest: Dictionary = _resolve_effective_manifest(gateway_fsm, adapted_mod_manifest)
    var solver_res: Dictionary = AuthoritativeReincarnationSolver.resolve_reincarnation_package(
        req,
        req.request_seed,
        effective_manifest
    )
    if not bool(solver_res.get("success", false)):
        return solver_res

    # 4. 角色三维实体组装
    var race_id := str(solver_res.get("race_id", "HUMAN"))
    var origin_id := str(solver_res.get("origin_id", ""))
    var char_id := "CHAR_%s_%s_%d" % [req.account_id, req.world_id, req.slot_id]
    var profile := _assemble_character_profile(char_id, char_name, solver_res)
    var _phys := _assemble_physiology(race_id, solver_res.get("attributes", {}))
    var _wallet := _assemble_wallet(profile, solver_res.get("wallet", {}))

    # 5. 初始背包装备物理水化
    var loadout_res: Dictionary = StarterLoadoutDispatcher.hydrate_starter_loadout_into_profile(
        profile,
        race_id,
        origin_id,
        effective_manifest
    )
    if not bool(loadout_res.get("success", false)):
        return loadout_res

    # 6. 世界时空连续性锚定、历史片段只增追加与世界MOD锁前置固化
    var continuity_res := _anchor_world_continuity(world_repo, req.world_id, profile, effective_manifest)
    if not bool(continuity_res.get("success", false)):
        return continuity_res
    var world_inst: WorldInstance = continuity_res.get("world_instance", null)

    # 7. 物理落盘与账号槽位封面同步绑定
    var persist_res := _persist_slot_and_cover(req, profile, race_id, origin_id, solver_res)
    if not bool(persist_res.get("success", false)):
        return persist_res

    # 8. 世界网关就绪角色回挂与状态跃迁
    var gateway_res: Dictionary = {}
    if gateway_fsm != null:
        gateway_res = gateway_fsm.attach_ready_character(profile.character_id)

    # 9. 构造全景只读呈现信封
    var pres := _build_presentation_envelope(req, profile, solver_res, loadout_res, world_inst)

    # 10. 发布全域领域事件
    var event_payload: Dictionary = pres.to_dto()
    EventBusCore.get_instance().emit_domain_event("character_creation.authoritative_completed", event_payload)

    return {
        "success": true,
        "character_id": profile.character_id,
        "character_name": profile.character_name,
        "slot_id": req.slot_id,
        "world_id": req.world_id,
        "profile": profile,
        "presentation": pres,
        "gateway_result": gateway_res
    }

# ==============================================================================
# 二、输入校验与实体组装子函数 (CC <= 15, Depth <= 3)
# ==============================================================================

## 请求入参防伪卫语句校验
static func _validate_request(req: AuthoritativeCharacterCreationRequestDTO) -> Dictionary:
    if req == null:
        return {"valid": false, "error_code": "INVALID_REQUEST", "message": "请求契约对象不可为空"}

    var char_name := req.character_name.strip_edges()
    if char_name.is_empty():
        return {"valid": false, "error_code": "EMPTY_NAME", "message": "角色名称不可为空"}

    if char_name.length() < 2 or char_name.length() > 16:
        return {"valid": false, "error_code": "INVALID_NAME_LENGTH", "message": "角色名称长度必须在 2 到 16 之间"}

    for i in FORBIDDEN_CHARS.size():
        if char_name.contains(FORBIDDEN_CHARS[i]):
            return {"valid": false, "error_code": "FORBIDDEN_CHARACTERS", "message": "角色名称包含非法特殊字符"}

    if req.account_id.strip_edges().is_empty():
        return {"valid": false, "error_code": "EMPTY_ACCOUNT_ID", "message": "账号标识不可为空"}

    if req.world_id.strip_edges().is_empty():
        return {"valid": false, "error_code": "EMPTY_WORLD_ID", "message": "世界标识不可为空"}

    if req.slot_id <= 0:
        return {"valid": false, "error_code": "EMPTY_SLOT_ID", "message": "槽位编号不可为空或小于等于0"}

    return {"valid": true, "character_name": char_name}

## 组装角色档案实体
static func _assemble_character_profile(char_id: String, char_name: String, solver_res: Dictionary) -> CharacterProfile:
    var profile := CharacterProfile.new()
    profile.character_id = char_id
    profile.character_name = char_name
    profile.attributes = (solver_res.get("attributes", {}) as Dictionary).duplicate(true)
    profile.growth_state = {
        "level": 1,
        "experience": 0,
        "origin_id": str(solver_res.get("origin_id", "")),
        "origin_name": str(solver_res.get("origin_name", "")),
        "race_id": str(solver_res.get("race_id", "")),
        "race_name": str(solver_res.get("race_name", "")),
        "gender": str(solver_res.get("gender", "")),
        "birth_region_id": str(solver_res.get("birth_region_id", "")),
        "selected_traits": (solver_res.get("selected_traits", []) as Array).duplicate(true),
        "traits_details": (solver_res.get("traits_details", []) as Array).duplicate(true)
    }
    return profile

## 组装生理档案
static func _assemble_physiology(race_id: String, attrs_map: Dictionary) -> CharacterPhysiologySheet:
    var phys := CharacterPhysiologySheet.new()
    phys.race_id = race_id
    for attr_key in attrs_map.keys():
        phys.set_level(str(attr_key), int(attrs_map[attr_key]))
    return phys

## 组装钱包实体与个人资源映射
static func _assemble_wallet(profile: CharacterProfile, solver_wallet: Dictionary) -> CharacterWalletEntity:
    var wallet := CharacterWalletEntity.new()
    wallet.gold = int(solver_wallet.get("gold", 50))
    wallet.copper = wallet.gold * 100

    profile.personal_resources = {
        "gold": wallet.gold,
        "wallet": {
            "copper": wallet.copper,
            "silver": wallet.silver,
            "gold": wallet.gold,
            "platinum": wallet.platinum,
            "mana_monocrystals": wallet.mana_monocrystals
        },
        "reputation": int(solver_wallet.get("reputation", 0))
    }
    return wallet

# ==============================================================================
# 三、时空连续性、物理持久化与信封组装
# ==============================================================================

## 解析生效的多MOD合并清单（显式入参优先，否则回退读取网关已预检清单）
static func _resolve_effective_manifest(
    gateway_fsm: WorldGatewayFSM,
    adapted_mod_manifest: Dictionary
) -> Dictionary:
    if not adapted_mod_manifest.is_empty():
        return adapted_mod_manifest
    if gateway_fsm != null:
        return gateway_fsm.get_adapted_mod_manifest()
    return {}

## 锚定目标世界时空、只增追加出生历史片段并前置固化世界MOD锁文件
static func _anchor_world_continuity(
    world_repo: WorldArchiveRepository,
    world_id: String,
    profile: CharacterProfile,
    effective_manifest: Dictionary = {}
) -> Dictionary:
    var world_inst: WorldInstance = world_repo.load_world(world_id)
    if world_inst == null:
        return {"success": false, "error_code": "WORLD_INSTANCE_LOAD_FAILED", "message": GameConfig.msg_fmt("character_creation", "world_instance_load_failed", {"world_id": world_id})}

    var birth_fragment: Dictionary = {
        "type": "CHARACTER_BORN",
        "character_id": profile.character_id,
        "character_name": profile.character_name,
        "world_time": (world_inst.world_time as Dictionary).duplicate(true)
    }
    world_inst.append_history_fragment(birth_fragment)
    var save_world_res: Dictionary = world_repo.save_world(world_inst)
    if not bool(save_world_res.get("success", false)):
        return {"success": false, "error_code": "WORLD_SAVE_FAILED", "message": "保存世界时空连续性失败"}

    var enabled_pack_ids: Array = effective_manifest.get("enabled_pack_ids", [])
    if not enabled_pack_ids.is_empty():
        WorldModAffinityManager.new().save_world_mod_lock(world_id, enabled_pack_ids)

    return {"success": true, "world_instance": world_inst}

## 执行槽位物理存盘与账号封面原子绑定
static func _persist_slot_and_cover(
    req: AuthoritativeCharacterCreationRequestDTO,
    profile: CharacterProfile,
    race_id: String,
    origin_id: String,
    solver_res: Dictionary
) -> Dictionary:
    var slot_name := "SLOT_%02d" % req.slot_id
    var save_payload: Dictionary = {
        "version": 1,
        "data": {
            "character_info": {
                "id": profile.character_id,
                "name": profile.character_name,
                "race": race_id,
                "origin": origin_id,
                "gender": str(solver_res.get("gender", "")),
                "world_id": req.world_id
            },
            "profile": profile.serialize(),
            "physiology": (solver_res.get("physiology", {}) as Dictionary).duplicate(true),
            "wallet": (profile.personal_resources.get("wallet", {}) as Dictionary).duplicate(true)
        }
    }
    var save_dal_res: Dictionary = SaveDataAccessLayer.save_game(slot_name, save_payload)

    var acc_repo := AccountRepository.get_instance()
    var account: AccountProfileAggregate = acc_repo.find_by_id(req.account_id)
    if account != null:
        var slot_dto := SaveSlotSummaryDTO.new()
        slot_dto.slot_id = slot_name
        slot_dto.character_name = profile.character_name
        slot_dto.world_id = req.world_id
        slot_dto.world_slot_status = "OCCUPIED"
        slot_dto.is_fallen = false
        slot_dto.last_saved_time_utc = int(Time.get_unix_time_from_system())
        slot_dto.save_file_sha256 = str(save_dal_res.get("sha256", ""))
        slot_dto.character_profile = profile
        account.bind_character_to_slot(slot_name, slot_dto)
        account.bind_world_slot(req.world_id, slot_name)
        acc_repo.save_account(account)

    return {"success": true, "slot_name": slot_name, "save_res": save_dal_res}

## 组装全景只读呈现信封
static func _build_presentation_envelope(
    req: AuthoritativeCharacterCreationRequestDTO,
    profile: CharacterProfile,
    solver_res: Dictionary,
    loadout_res: Dictionary,
    world_inst: WorldInstance
) -> CharacterCreationPresentationDTO:
    var pres := CharacterCreationPresentationDTO.new()
    pres.character_id = profile.character_id
    pres.character_name = profile.character_name
    pres.origin_id = str(solver_res.get("origin_id", ""))
    pres.origin_name = str(solver_res.get("origin_name", ""))
    pres.origin_desc = str(solver_res.get("origin_desc", ""))
    pres.race_id = str(solver_res.get("race_id", "HUMAN"))
    pres.race_name = str(solver_res.get("race_name", ""))
    pres.gender = str(solver_res.get("gender", ""))
    pres.attributes_radar = (solver_res.get("attributes", {}) as Dictionary).duplicate(true)
    pres.physiology_summary = (solver_res.get("physiology", {}) as Dictionary).duplicate(true)
    pres.wallet_summary = (solver_res.get("wallet", {}) as Dictionary).duplicate(true)

    var starter_items: Array[Dictionary] = []
    var raw_starter_items: Array = loadout_res.get("starter_items_summary", [])
    starter_items.assign(raw_starter_items)
    pres.starter_equipment = starter_items

    pres.world_chronicle = {
        "world_id": req.world_id,
        "world_time": (world_inst.world_time as Dictionary).duplicate(true),
        "history_fragments_count": world_inst.history_fragments.size()
    }
    pres.prologue_preview = {
        "birth_region_id": str(solver_res.get("birth_region_id", "")),
        "base_factions": (solver_res.get("base_factions", {}) as Dictionary).duplicate(true),
        "selected_traits": (solver_res.get("selected_traits", []) as Array).duplicate(true)
    }
    return pres
