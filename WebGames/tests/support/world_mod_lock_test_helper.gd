# ==============================================================================
# 模块归属: 测试支撑 (Tests · Support Fixtures)
# 文件路径: res://tests/support/world_mod_lock_test_helper.gd
# 架构定位: Test Fixture Helper / World MOD Lock & Degrade Sandbox Helper
# 依赖与触发: 上游: TestWorldModLockReentryAndDrift | 下游: WorldModAffinityManager, WorldCharacterCreationOrchestrator, WorldArchiveRepository | 配置: 无
# 职责说明: 为世界存档 MOD 锁测试提供沙盒清理、绑定锁定世界并创角以及安全降级历史片段核验夹具。
# 退出语义与设计依据: 测试夹具共享与沙盒隔离契约
# ==============================================================================

## WorldModLockTestHelper：世界 MOD 锁测试沙盒构造、创角固化与降级历史检查器
class_name WorldModLockTestHelper
extends RefCounted

const WorldGatewayModel = preload("res://backend/domains/world_gateway/world_gateway_model.gd")
const WorldGatewayFSM = preload("res://backend/domains/world_gateway/world_gateway_fsm.gd")
const WorldModAffinityManager = preload("res://backend/domains/narrative_orchestration/world_mod_affinity_manager.gd")
const WorldCharacterCreationOrchestrator = preload("res://backend/domains/character_creation/world_character_creation_orchestrator.gd")
const AuthoritativeCharacterCreationRequestDTO = preload("res://backend/domains/character_creation/dto/authoritative_character_creation_request_dto.gd")
const WorldArchiveRepository = preload("res://backend/domains/world_state/world_archive_repository.gd")
const WorldInstance = preload("res://backend/domains/world_state/world_instance.gd")

const LOCKED_WORLD_ID: String = "WORLD_P130_LOCK_REENTRY_01"


## 清理指定测试世界的 world_mod_lock.json 并卸载激活 MOD 叠层
static func cleanup_world_lock_sandbox() -> void:
    var lock_path := WorldModAffinityManager.new().get_lock_file_path(LOCKED_WORLD_ID)
    if FileAccess.file_exists(lock_path):
        DirAccess.remove_absolute(lock_path)
    TestCase.unmount_mod_overlay_for_test()


## 挂载官方基础包、创建单机世界档案并完成权威创角与锁文件固化
static func seed_locked_world_and_character() -> Dictionary:
    TestCase.mount_official_kalar_for_test()
    var world := WorldInstance.new(LOCKED_WORLD_ID)
    WorldArchiveRepository.get_instance().save_world(world)

    var fsm := WorldGatewayFSM.new("ACC_WLD_LOCK")
    fsm.enter_gateway()
    fsm.select_mode(WorldGatewayModel.GameMode.SINGLE_PLAYER, {}, [], LOCKED_WORLD_ID, "SLOT_01")

    var req := AuthoritativeCharacterCreationRequestDTO.new()
    req.account_id = "ACC_WLD_LOCK"
    req.world_id = LOCKED_WORLD_ID
    req.slot_id = 1
    req.character_name = "LocksmithHero"
    req.request_seed = 9001

    var char_res := WorldCharacterCreationOrchestrator.create_character_authoritative(req, fsm)
    var char_id := str(char_res.get("character_id", ""))
    fsm.logout()
    return {"created": bool(char_res.get("success", false)), "character_id": char_id}


## 判断指定世界存档是否写入了 MOD_DETACHED 安全降级历史片段
static func has_detached_fragment(world_id: String) -> bool:
    var reloaded_world := WorldArchiveRepository.get_instance().load_world(world_id)
    if reloaded_world == null:
        return false
    for fragment in reloaded_world.history_fragments:
        if fragment is Dictionary and str((fragment as Dictionary).get("type", "")) == "MOD_DETACHED":
            return true
    return false
