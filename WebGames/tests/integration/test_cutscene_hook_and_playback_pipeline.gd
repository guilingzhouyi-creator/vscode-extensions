# ==============================================================================
# 模块归属: 集成测试层 (Integration · 全域非阻塞CG视频播放与剧情通用Hook流水线)
# 文件路径: res://tests/integration/test_cutscene_hook_and_playback_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 依赖与触发: 上游: TestRegistry | 下游: CutsceneRequestDTO, CutsceneAsyncLoader, CutsceneHookRegistry, CutsceneOrchestrator, CutscenePlayerView, NarrativeDagExecutionEngine
# 职责说明: Phase 126 全域非阻塞 CG 视频播放与剧情通用 Hook 引擎全链路验收集成测试套件；
#           全面断言参数化 DTO、非阻塞流式装载、LRU 缓存、Hook 路由拦截、长按跳过互锁、
#           无艺术资产时的文字占位演播（Text Placeholder）与主线程纯通用调用闭环。
# 设计依据: Phase 126 阶段4验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestCutsceneHookAndPlaybackPipeline
extends TestCase

const CutsceneRequestDTO = preload("res://backend/infrastructure/media/dto/cutscene_request_dto.gd")
const CutscenePlaybackStateDTO = preload("res://backend/infrastructure/media/dto/cutscene_playback_state_dto.gd")
const CutsceneManifestDTO = preload("res://backend/infrastructure/media/dto/cutscene_manifest_dto.gd")
const CutsceneAsyncLoader = preload("res://backend/infrastructure/media/cutscene_async_loader.gd")
const CutsceneHookRegistry = preload("res://backend/infrastructure/media/cutscene_hook_registry.gd")
const CutsceneOrchestrator = preload("res://backend/infrastructure/media/cutscene_orchestrator.gd")
const CutscenePreloadPredictor = preload("res://backend/infrastructure/media/cutscene_preload_predictor.gd")
const CutscenePlayerView = preload("res://frontend/views/cutscene_player/cutscene_player_view.gd")
const CutscenePresenterClass = preload("res://frontend/presentation/common/cutscene_presenter.gd")
const CutsceneEventBridge = preload("res://frontend/systems/cutscene_event_bridge.gd")

const NarrativeDagExecutionEngine = preload("res://backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd")
const NarrativeDAGGraphDTO = preload("res://backend/domains/narrative_orchestration/narrative_dag_graph_dto.gd")
const NarrativeDAGNode = preload("res://backend/domains/narrative_orchestration/narrative_dag_node.gd")
const NarrativeDAGEdge = preload("res://backend/domains/narrative_orchestration/narrative_dag_edge.gd")

# ==============================================================================
# 一、测试套件总入口与环境重置
# ==============================================================================

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_cs_01_request_dto_parameters_and_duplication())
	results.append(test_tc_cs_02_async_loader_nonblocking_and_lru_cache())
	results.append(test_tc_cs_03_hook_registry_and_narrative_interception())
	results.append(test_tc_cs_04_orchestrator_lifecycle_and_skip_interlock())
	results.append(test_tc_cs_05_player_view_and_presenter_integration())
	results.append(test_tc_cs_06_zero_hardcoding_and_architecture_closure())

	return pack_results("Cutscene Hook & Playback Pipeline", results)

# ==============================================================================
# 二、核心测试场景 (TC-CS-01 ~ TC-CS-06)
# ==============================================================================

## TC-CS-01: 参数化 CutsceneRequestDTO 默认值、序列化与深拷贝自检
static func test_tc_cs_01_request_dto_parameters_and_duplication() -> Dictionary:
	var req := CutsceneRequestDTO.new()
	var default_ok: bool = req.skippable == true \
		and is_equal_approx(req.skip_hold_duration_sec, 0.3) \
		and is_equal_approx(req.fade_in_sec, 0.5) \
		and is_equal_approx(req.fade_out_sec, 0.5) \
		and req.auto_pause_world == true \
		and req.hide_hud == true \
		and req.audio_bus == "BGM" \
		and is_equal_approx(req.duration_sec, 3.0) \
		and req.is_placeholder == false

	# 自定义参数覆盖与序列化
	req.cutscene_id = "cs_boss_intro"
	req.video_path = "res://assets/media/cutscenes/boss_intro.ogv"
	req.volume_linear = 0.8
	req.audio_bus = "Cutscene"
	req.is_placeholder = true
	req.placeholder_title = "Boss Intro Scene"
	req.placeholder_text = "巨龙在深渊边缘咆哮..."
	req.context_payload = {"quest_id": "q101", "boss_name": "Dragon"}

	var dict_data := req.to_dict()
	var restored := CutsceneRequestDTO.from_dict(dict_data)
	var restore_ok: bool = restored.cutscene_id == "cs_boss_intro" \
		and restored.audio_bus == "Cutscene" \
		and is_equal_approx(restored.volume_linear, 0.8) \
		and restored.is_placeholder == true \
		and restored.placeholder_title == "Boss Intro Scene" \
		and restored.placeholder_text == "巨龙在深渊边缘咆哮..." \
		and restored.context_payload.get("boss_name", "") == "Dragon"

	var dup := req.duplicate_request()
	var dup_ok: bool = (dup != req) and (dup.cutscene_id == req.cutscene_id) \
		and (dup.placeholder_title == req.placeholder_title)

	var passed: bool = default_ok and restore_ok and dup_ok
	return make_result("TC-CS-01: 参数化 CutsceneRequestDTO 默认值与深拷贝自检", passed, {
		"default_ok": default_ok,
		"restore_ok": restore_ok,
		"dup_ok": dup_ok
	})

## TC-CS-02: 异步加载器非阻塞流式装载、LRU 定容淘汰与无物理文件优雅降级
static func test_tc_cs_02_async_loader_nonblocking_and_lru_cache() -> Dictionary:
	var loader := CutsceneAsyncLoader.new()
	loader.set_deterministic_mode(true)
	loader.set_cache_capacity(2)

	# 1. 异步装载请求仿真
	var cb_called: Array[bool] = [false]
	var task_id := loader.request_load("res://assets/video/test1.ogv", 1, func(_res: Resource):
		cb_called[0] = true
	)
	var task_ok: bool = (task_id >= 0) and cb_called[0]
	var ready_ok: bool = loader.is_resource_ready("res://assets/video/test1.ogv")

	# 2. LRU 缓存定容淘汰测试 (容量=2, 存入 3 个)
	loader.request_load("res://assets/video/test2.ogv")
	loader.request_load("res://assets/video/test3.ogv")

	var test1_evicted: bool = not loader.is_resource_ready("res://assets/video/test1.ogv")
	var test2_kept: bool = loader.is_resource_ready("res://assets/video/test2.ogv")
	var test3_kept: bool = loader.is_resource_ready("res://assets/video/test3.ogv")
	var lru_ok: bool = test1_evicted and test2_kept and test3_kept

	# 3. 生产模式无艺术资源时优雅降级为文字占位（不悬挂卡死）
	loader.set_deterministic_mode(false)
	var fallback_called: Array[bool] = [false]
	var fallback_res: Array[Resource] = [Resource.new()]
	loader.request_load("res://nonexistent/mock_video.ogv", 1, func(res: Resource):
		fallback_called[0] = true
		fallback_res[0] = res
	)
	var fallback_ok: bool = fallback_called[0] and (fallback_res[0] == null) \
		and loader.get_last_error_code("res://nonexistent/mock_video.ogv") == CutsceneAsyncLoader.ERR_MEDIA_MISSING

	# 4. 任务取消自检（真实 res:// 线程任务处于 LOADING 时可被 cancel_task 终止并清理线程槽位）
	var cancel_task_id := loader.request_load("res://icon.svg")
	var cancel_ok: bool = loader.cancel_task(cancel_task_id) \
		and loader.get_task_status(cancel_task_id) == CutsceneAsyncLoader.STATUS_CANCELLED
	var _drain_cancelled: Variant = ResourceLoader.load_threaded_get("res://icon.svg")

	loader.clear_cache_and_tasks()
	var passed: bool = task_ok and ready_ok and lru_ok and fallback_ok and cancel_ok
	return make_result("TC-CS-02: 异步加载器非阻塞装载与 LRU 缓存定容淘汰", passed, {
		"task_ok": task_ok,
		"ready_ok": ready_ok,
		"lru_ok": lru_ok,
		"fallback_ok": fallback_ok,
		"cancel_ok": cancel_ok
	})

## TC-CS-03: Hook 注册表对剧情 DAG 节点的拦截解算与防重复放映
static func test_tc_cs_03_hook_registry_and_narrative_interception() -> Dictionary:
	var registry := CutsceneHookRegistry.new()

	# 1. 注册资产清单（含文字占位元数据）
	var manifest := CutsceneManifestDTO.new()
	manifest.cutscene_id = "cs_prologue"
	manifest.video_resource_path = "res://assets/video/prologue.ogv"
	manifest.default_audio_bus = "BGM"
	manifest.default_skippable = true
	manifest.is_placeholder = true
	manifest.placeholder_title = "序章觉醒演播"
	manifest.placeholder_text = "【文字占位】天穹之上泛起赤色微光..."
	registry.register_manifest(manifest)

	# 2. 注册前置 Hook
	registry.register_hook({
		"hook_id": "h_prologue_pre",
		"trigger_type": CutsceneHookRegistry.TRIGGER_NARRATIVE_NODE_PRE,
		"target_filter": {"dag_id": "dag_main", "node_id": "node_entry"},
		"cutscene_id": "cs_prologue",
		"override_params": {"fade_in_sec": 1.0, "play_once_per_save": true}
	})

	# 3. 匹配拦截并解析参数
	var req := registry.match_narrative_hook("dag_main", "node_entry", true)
	var match_ok: bool = req != null \
		and req.cutscene_id == "cs_prologue" \
		and is_equal_approx(req.fade_in_sec, 1.0) \
		and req.is_placeholder == true \
		and req.placeholder_title == "序章觉醒演播"

	# 4. play_once_per_save 防重复拦截
	registry.mark_cutscene_viewed("cs_prologue")
	var req_second := registry.match_narrative_hook("dag_main", "node_entry", true)
	var repeat_blocked: bool = (req_second == null)

	# 5. 未匹配节点回退
	var req_unmatched := registry.match_narrative_hook("dag_main", "node_other", true)
	var unmatched_ok: bool = (req_unmatched == null)

	var passed: bool = match_ok and repeat_blocked and unmatched_ok
	return make_result("TC-CS-03: Hook 注册表对剧情 DAG 节点的拦截解算与防重复放映", passed, {
		"match_ok": match_ok,
		"repeat_blocked": repeat_blocked,
		"unmatched_ok": unmatched_ok
	})

## TC-CS-04: 主线程通用调用 (play_by_id / parse_and_play) 与生命周期闭环
static func test_tc_cs_04_orchestrator_lifecycle_and_skip_interlock() -> Dictionary:
	var orch := CutsceneOrchestrator.new()
	var loader := CutsceneAsyncLoader.get_instance()
	loader.set_deterministic_mode(true)

	var completed_called: Array[bool] = [false]
	var skipped_called: Array[bool] = [false]

	# 1. 主线程快速调用 play_cutscene
	var req := CutsceneRequestDTO.new()
	req.cutscene_id = "cs_sim_test"
	req.video_path = "res://assets/video/sim.ogv"
	req.duration_sec = 10.0
	req.skippable = true
	req.on_completed = func():
		completed_called[0] = true
	req.on_skipped = func():
		skipped_called[0] = true

	var start_res := orch.play_cutscene(req)
	var start_ok: bool = bool(start_res.get("success", false)) and orch.is_playing()

	# 2. 确定性步进更新
	orch.step_simulation(5.0)
	var state := orch.get_playback_state()
	var step_ok: bool = is_equal_approx(state.current_time_sec, 5.0)

	# 3. 玩家主动跳过
	var skip_success: bool = orch.skip_cutscene()
	var skip_ok: bool = skip_success and skipped_called[0] and not orch.is_playing()

	# 4. 主线程纯通用字典解析播放 (parse_and_play)
	var parse_play_res := orch.parse_and_play({
		"cutscene_id": "cs_generic_payload",
		"duration_sec": 4.0,
		"is_placeholder": true,
		"placeholder_title": "Generic Scene",
		"skippable": true
	})
	var parse_ok: bool = bool(parse_play_res.get("success", false)) and orch.is_playing()
	orch.step_simulation(5.0) # 步进超长自然完结
	var auto_finish_ok: bool = not orch.is_playing()

	var passed: bool = start_ok and step_ok and skip_ok and parse_ok and auto_finish_ok
	return make_result("TC-CS-04: 主线程通用调用与生命周期闭环", passed, {
		"start_ok": start_ok,
		"step_ok": step_ok,
		"skip_ok": skip_ok,
		"parse_ok": parse_ok,
		"auto_finish_ok": auto_finish_ok
	})

## TC-CS-05: 表现层视口装配、文字占位演播驱动与字幕快照单向注入
static func test_tc_cs_05_player_view_and_presenter_integration() -> Dictionary:
	var view := CutscenePlayerView.new()
	var presenter := CutscenePresenterClass.new()
	presenter.bind_view(view)

	var finish_called: Array[bool] = [false]
	var skip_called: Array[bool] = [false]
	presenter.configure_orchestration(
		func(_path: String) -> Resource: return null,
		func(): finish_called[0] = true,
		func(): skip_called[0] = true
	)

	# 1. 模拟收到全域开始播放事件（无艺术物理资源，触发文字占位演示）
	presenter.handle_cutscene_started({
		"cutscene_id": "cs_ui_placeholder",
		"is_placeholder": true,
		"placeholder_title": "序章测试演播",
		"placeholder_text": "晨星闪烁，守护者的长阶前升起了迷雾...",
		"duration_sec": 1.0,
		"skippable": true,
		"skip_prompt_text": "[ESC / Space] 跳过",
		"audio_bus": "BGM",
		"fade_in_sec": 0.1
	})
	var view_shown: bool = view.visible
	var placeholder_box: Control = view.get_node_or_null("PlaceholderContainer")
	var placeholder_active: bool = placeholder_box != null and placeholder_box.visible

	# 2. 模拟经过 1.2 秒帧推进，断言文字占位演示自动推进至完结并触发信号
	view._process(1.2)
	var placeholder_finished_ok: bool = finish_called[0]

	# 3. 视口清理与解绑
	presenter.unbind_view()
	view.free()

	# 4. 验证 CutsceneEventBridge 经 EventBusCore 全域解耦消费闭环（待命零接线契约）
	var bridge := CutsceneEventBridge.new()
	var host := Control.new()
	bridge.attach_host(host)
	var bridge_attached_ok: bool = bridge.is_attached()

	# 经总线广播 cutscene.started
	var bus: EventBusCore = EventBusCore.get_instance()
	bus.emit_domain_event("cutscene.started", {
		"cutscene_id": "cs_eb_test",
		"is_placeholder": true,
		"placeholder_title": "总线桥接测试",
		"duration_sec": 2.0
	})
	var bridge_consuming_ok: bool = bridge.is_consuming() and bridge.get_active_cutscene_id() == "cs_eb_test"
	var dynamic_view_created: bool = bridge.get_active_view() != null

	# 经总线广播 cutscene.finished
	bus.emit_domain_event("cutscene.finished", {"cutscene_id": "cs_eb_test"})
	var bridge_finished_ok: bool = not bridge.is_consuming()

	bridge.detach_all()
	host.free()
	var bridge_clean_ok: bool = not bridge.is_attached()

	var bridge_ok: bool = bridge_attached_ok and bridge_consuming_ok and dynamic_view_created and bridge_finished_ok and bridge_clean_ok
	var passed: bool = view_shown and placeholder_active and placeholder_finished_ok and bridge_ok
	return make_result("TC-CS-05: 表现层视口装配、文字占位演播驱动与总线消费桥接", passed, {
		"view_shown": view_shown,
		"placeholder_active": placeholder_active,
		"placeholder_finished_ok": placeholder_finished_ok,
		"bridge_ok": bridge_ok
	})

## TC-CS-06: 剧情与任务全域零硬编码护栏与架构闭包
static func test_tc_cs_06_zero_hardcoding_and_architecture_closure() -> Dictionary:
	# 1. 验证 NarrativeDagExecutionEngine 挂载了非侵入式 Hook 拦截接口
	var engine := NarrativeDagExecutionEngine.new()
	var interceptor_called: Array[bool] = [false]
	engine.set_hook_interceptor(func(_dag_id: String, _node_id: String, _is_pre: bool):
		interceptor_called[0] = true
	)

	# 2. 构造微型单节点图并执行
	var graph := NarrativeDAGGraphDTO.new()
	graph.dag_id = "test_dag_closure"
	var node := NarrativeDAGNode.new()
	node.node_id = "n_start"
	node.node_type = NarrativeDAGNode.NodeType.START_ENTRY
	graph.nodes["n_start"] = node
	graph.entry_node_id = "n_start"

	engine.initialize_with_graph(graph)
	var pre_interceptor_ok: bool = interceptor_called[0]

	# 3. 验证 CutsceneOrchestrator 单例状态重置安全性
	var orch := CutsceneOrchestrator.get_instance()
	var orch_idle_ok: bool = not orch.is_playing()

	var passed: bool = pre_interceptor_ok and orch_idle_ok
	return make_result("TC-CS-06: 剧情零硬编码拦截与架构闭包", passed, {
		"pre_interceptor_ok": pre_interceptor_ok,
		"orch_idle_ok": orch_idle_ok
	})
