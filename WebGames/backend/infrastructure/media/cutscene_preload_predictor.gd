# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 媒体与全域CG动画 (Media & Cutscene))
# 文件路径: res://backend/infrastructure/media/cutscene_preload_predictor.gd
# 架构定位: Predictive Pipeline Optimizer / Lookahead Media Cache Warmer
# 依赖与触发: 上游: NarrativeDagExecutionEngine | 下游: CutsceneHookRegistry, CutsceneAsyncLoader
# 职责说明: 监听剧情 DAG 节点推进事件，分析拓扑前向出边并预测即将到达的下游 CG 节点；
#           提前 1~2 节点启动非阻塞流式预热装载，消除玩家进入 CG 环节时的冷启动缓冲等待。
# 退出语义与设计依据: 前向预取拓扑算法与零等待流畅体验规约 (Inv-NONBLOCK-LOAD-1)
# ==============================================================================

## CutscenePreloadPredictor：前向拓扑预测预取器
class_name CutscenePreloadPredictor
extends RefCounted

const CutsceneHookRegistryClass = preload("res://backend/infrastructure/media/cutscene_hook_registry.gd")
const CutsceneAsyncLoaderClass = preload("res://backend/infrastructure/media/cutscene_async_loader.gd")
const CutsceneRequestDTOClass = preload("res://backend/infrastructure/media/dto/cutscene_request_dto.gd")

static var _instance: CutscenePreloadPredictor = null

static func get_instance() -> CutscenePreloadPredictor:
	if _instance == null:
		_instance = CutscenePreloadPredictor.new()
	return _instance

## 分析下游可达节点列表并触发预测性预加载
func predict_and_preload_downstream(dag_id: String, candidate_next_node_ids: Array[String]) -> int:
	if dag_id.is_empty() or candidate_next_node_ids.is_empty():
		return 0

	var preloaded_count: int = 0
	var registry := CutsceneHookRegistryClass.get_instance()
	var loader := CutsceneAsyncLoaderClass.get_instance()

	for next_node_id in candidate_next_node_ids:
		# 尝试探测下游节点是否有前置或后置 CG Hook
		var pre_req: CutsceneRequestDTO = registry.match_narrative_hook(dag_id, next_node_id, true)
		if pre_req != null and not pre_req.video_path.is_empty():
			if not loader.is_resource_ready(pre_req.video_path):
				loader.request_load(pre_req.video_path, pre_req.preload_priority)
				preloaded_count += 1

		var post_req: CutsceneRequestDTO = registry.match_narrative_hook(dag_id, next_node_id, false)
		if post_req != null and not post_req.video_path.is_empty():
			if not loader.is_resource_ready(post_req.video_path):
				loader.request_load(post_req.video_path, post_req.preload_priority)
				preloaded_count += 1

	return preloaded_count
