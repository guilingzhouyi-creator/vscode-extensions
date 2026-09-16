---
档号: KALAR-DEV-2026-ST46-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST46 (Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_50_通用剧情因果DAG编排引擎与多角色差异化拓扑 —— 阶段4：DAG编排拓扑多分支汇聚与环检测验收测试矩阵
形成日期: 2026-09-03
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: DAG编排拓扑多分支汇聚; prologue_dag_catalog.json
---

# 施工细则：阶段4_DAG编排拓扑多分支汇聚与环检测验收测试矩阵

> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST46-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST46-001_阶段1_剧情因果DAG模型节点分支契约与拓扑规范设计.md) ｜ [阶段2](KALAR-DEV-2026-ST46-002_阶段2_DAG拓扑解析器环依赖检测与状态跃迁执行引擎实现.md) ｜ [阶段3](KALAR-DEV-2026-ST46-003_阶段3_多角色差异化序章配置架构与EventBus总线接线工程化.md) ｜ **阶段4 (当前)**

> 施工开始日期: 2026-09-03 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已完成第2轮闭环验收（100% PASS）

---

## 一、 验收目标与测试集架构 (对齐 P10.10)

本阶段为通用剧情因果 DAG 编排引擎与多角色差异化序章构建专属无头测试套件 `TestNarrativeDagOrchestrationPipeline`（`tests/unit/test_narrative_dag_orchestration_pipeline.gd`）。

测试套件挂载于既有测试宿主：并入 `Domain 30: narrative_orchestration`，严格维持全域 47 个业务领域宏观护栏（`TC-ARCH-01 ~ 05`）。

---

## 二、 6 大核心用例验收矩阵 (DoD Checklist)

| 用例编号 | 用例名称与验证意图 | 触发前置条件与动作 | 核心断言与预期输出 | 对应 P10 标准条目 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-DAG-01** | DAG 静态拓扑排序与结构合法性 | 加载标准单向/分支剧情 DAG | `CausalityDagValidator.validate_graph` 返回 `is_valid == true`，所有节点可达 | P10.6 / P10.10 |
| **TC-DAG-02** | 拓扑环依赖与死锁环 100% 拦截 | 构造含回环的恶意图元（$A \to B \to C \to A$） | 校验器精准拦截，返回 `is_valid == false` 与错误码 `CYCLE_DETECTED` | P10.6 / P10.10 |
| **TC-DAG-03** | 汇聚节点依赖等待与条件同步激活 | 汇聚节点设置依赖两个前置；先推进其中一条分支 | 汇聚节点在前置未齐备前保持休眠，双前置达成后立即被激活 | P10.6 / P10.10 |
| **TC-DAG-04** | 条件分支动态选择与路径分流 | 分支节点设置不同 `CHOICE` 条件，输入特定动作 | 仅满足条件的目标出边下游节点被激活，未选中分支保持未激活 | P10.6 / P10.7 |
| **TC-DAG-05** | 角色种族差异化序章配置路由 | 分别传入人族与精灵族角色序章上下文 | `PrologueDagRegistry` 自动解析出不同的 DAG 结构（王都广场 vs 精灵圣林） | P10.1 / P10.9 |
| **TC-DAG-06** | 创角到序章 DAG 完结全生命周期闭环 | 执行完整链路：创角 $\to$ 实例化上下文 $\to$ 挂载对应 DAG $\to$ 推进至终态 $\to$ 入界 | 全程事件总线广播合规，最终触发 `narrative.dag.completed`，全域无死锁 | P10.10 全生命周期 |

---

## 三、 测试套件无头执行架构规范

```gdscript
class_name TestNarrativeDagOrchestrationPipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_dag_topological_sort_validity())
	results.append(_test_dag_cycle_detection_guard())
	results.append(_test_convergence_join_synchronization())
	results.append(_test_conditional_branching_path())
	results.append(_test_multi_race_dag_routing())
	results.append(_test_full_lifecycle_creation_to_dag_completion())

	var passed_count := 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_count += 1

	return {
		"suite_name": "TestNarrativeDagOrchestrationPipeline",
		"total": results.size(),
		"passed": passed_count,
		"results": results
	}
```

---

## 四、 17 道全域工程门禁约束

实施阶段完成后，必须经由 `pwsh -File scripts/ps1/audit-all.ps1` 进行全域自动化门禁审查：

1. **GDScript 语法治理** (`check-gdscript.ps1`)：100% 编译通过，0 语法错误；
2. **确定性无随机契约** (`audit_arch.py: TC-ARCH-04`)：零裸随机调用；
3. **零硬编码与配置键存在性** (`TC-ARCH-06`)：代码读取的键在 `prologue_dag_catalog.json` 中真实存在；
4. **文档四域一致性** (`audit_docs.py`)：0 Error / 0 Warn；
5. **单元测试验收** (`test-run.ps1`)：全量测试套件 100% PASS，断言正向增长。
