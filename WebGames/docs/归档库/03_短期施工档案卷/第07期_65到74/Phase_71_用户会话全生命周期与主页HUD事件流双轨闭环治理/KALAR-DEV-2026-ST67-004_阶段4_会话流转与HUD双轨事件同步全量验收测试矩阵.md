---
档号: KALAR-DEV-2026-ST67-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST67 (Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段4：会话流转与HUD双轨事件同步全量验收测试矩阵
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: 全链路无死锁断言; 零前端改动铁律; 除数下限零崩溃
---

# 施工细则：Phase 71 用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段4：会话流转与HUD双轨事件同步全量验收测试矩阵

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：建立 Phase 71 专属自动化测试套件（`TestSessionLifecycleAndHudSyncPipeline`），构建覆盖「注册 ➔ 登录 ➔ 选角输入昵称 ➔ 序章剧情 ➔ 进世界主页 HUD 双轨推拉 ➔ 安全退出保存」全闭环链路的验收断言矩阵，确保：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md)。
> 1. 标准账号注册与会话广播 100% 具备单测覆盖（广播 payload 契约完备）；
> 2. 主页 HUD 权威快照与增量事件推流 100% 具备断言（真实 API 溯源 + 除数下限守卫）；
> 3. 全链路无头贯穿测试串联既有各阶段成果；
> 4. 严格断言前端目录（`frontend/`）零修改、零代码污染；
> 5. 全域既有测试基线全绿回归，门禁全绿，无常驻内存泄漏。
> **对应需求源**：Phase 71 阶段 1~3；用户全链路闭环调查与无头要求；`tests/test_registry.gd`（全域测试注册中心）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST67-001_阶段1_用户会话生命周期与HUD只读快照数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST67-002_阶段2_会话鉴权事件总线与HUD双轨同步核心算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST67-003_阶段3_配置驱动扩展与全域EventBus无头接线工程化.md) ｜ **阶段4 (当前)**

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - `tests/test_registry.gd`：全域测试注册中心（`get_all_test_classes()` 收录，TC-ARCH-03 校验）——**新增套件挂载至下一空槽**，不预设固定序号（registry 实况 99 个 preload，序号以 `test_registry.gd` 现有尾部为准）；
  - 全域既有基线（路线图总索引 2026-09-08 实况）：93 套 / 644 断言 100% PASS，门禁 18 项全绿——本卷不得低于该基线；
  - `tests/unit/test_account.gd`、`test_character_creation_and_opening_pipeline.gd`、`test_prologue_core_and_placeholder_pipeline.gd`、`test_game_lifecycle_pipeline.gd`：全链路各段既有测试基线（复用其宿主/桩）；
  - `scripts/py/audit_gd_style.py` / `scripts/py/audit_config.py` / `audit_copywriting.py` / `audit_config_unused.py` / `audit-all`：静态与配置门禁链。
* **核心不变量约束断言**：
  - `Inv-HDS4-1 (全链路无死锁断言)`：注册到停机退出的全闭环无头测试运行时间 < 500ms，单向推进无阻塞；
  - `Inv-HDS4-2 (零前端改动铁律)`：Git diff 与文件哈希核查，`frontend/` 目录改动数 0；
  - `Inv-HDS4-3 (除数下限零崩溃)`：`hp_max/ap_max` 输入 0/负数/NaN 时快照下限守卫严格生效；
  - `Inv-HDS4-4 (真实溯源零臆造断言)`：快照 `attribute_values` 与 `CharacterPhysiologySheet.get_actual_values()` 深度一致；快照无 mp/level/exp 等无权威源字段（防臆造白名单）。
* **防漂移最高指示**：断言必须基于真实实体 API 返回值与配置真源；禁止为通过断言而把演示常量伪装成权威值；`frontend/` 零修改为红线，任何触碰即判失败。

---

## 一、 专属验收测试套件设计 (Test Pipeline Design)

* 模块路径: `res://tests/unit/test_session_lifecycle_and_hud_sync_pipeline.gd`
* 类名: `TestSessionLifecycleAndHudSyncPipeline`
* 挂载位置: `tests/test_registry.gd` 下一空槽（与既有 `TestRegistry` 分组一致；同步 `get_all_test_classes()` 与 `test_architecture_guard.gd` TC-ARCH-03 登记）

```gdscript
class_name TestSessionLifecycleAndHudSyncPipeline
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(_test_account_registration_validation_and_duplicate())
	results.append(_test_auth_eventbus_lifecycle_broadcast())
	results.append(_test_hud_snapshot_dto_and_divider_guards())
	results.append(_test_hud_snapshot_real_source_derivation())
	results.append(_test_hud_state_sync_service_pull_facade())
	results.append(_test_hud_eventbus_push_stream())
	results.append(_test_full_headless_lifecycle_pipeline())
	results.append(_test_frontend_zero_intrusion_guard())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1
	return {
		"domain": "Phase 71: 用户会话生命周期与主页HUD双轨同步测试套件",
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}
```

---

## 二、 核心用例断言矩阵 (Test Cases Specification)

| 用例 ID | 测试目标与执行步骤 | 预期断言结果 | 对应不变量 |
| :--- | :--- | :--- | :--- |
| **`TC-HDS-01`** | **标准账号注册校验与重名拦截**<br>1. 空密码/越界用户名；2. 合规注册；3. 同名二次注册。 | 1. 返回配置化错误码拒绝；2. 注册成功唯一 ID；3. `ERR_ACCOUNT_ALREADY_EXISTS` 拦截。 | `Inv-HDS2-1`<br>`Inv-HDS3-1` |
| **`TC-HDS-02`** | **鉴权 EventBus 全周期广播（契约完备）**<br>1. 监听 `account.*`；2. 注册/登录/注销。 | 依次捕获三事件；载荷含 `category_key/auth` + `args`；登录载荷 token 前缀 ≤8、无明文密码/哈希。 | `Inv-HDS-4`<br>`Inv-HDS2-5` |
| **`TC-HDS-03`** | **快照 DTO 序列化与除数守卫**<br>构造 `hp_max=0.0/-10.0`、`ap_max=0` 异常字典。 | `from_dto` 钳制 `hp_max/ap_max >= 1.0`；往返序列化深度一致。 | `Inv-HDS-3`<br>`Inv-HDS4-3` |
| **`TC-HDS-04`** | **快照真实溯源与防臆造白名单**<br>构造真实 `CharacterPhysiologySheet`/`CharacterWalletEntity` 调 `get_hud_status_snapshot()`。 | `attribute_values` 与 `get_actual_values()` 深度一致；`wallet_gold/mana_monocrystals` 与实体一致；快照无 mp/level/exp 字段。 | `Inv-HDS-1`<br>`Inv-HDS4-4` |
| **`TC-HDS-05`** | **无头推轨事件流广播**<br>监听 `world_state.*`；调全量快照与增量方法。 | `world_state.snapshot_published` 收到完整载荷；`stat_mutated`/`wallet_mutated` 收到 delta 与 args；监听方改动不反污染实体（深拷贝隔离）。 | `Inv-HDS-2`<br>`Inv-HDS2-3` |
| **`TC-HDS-06`** | **全生命周期无头闭环贯穿集成测试**<br>注册 ➔ 加盐登录 ➔ 选角输入昵称 ➔ 序章四阶段 ➔ 进世界（`world_entered` 触发首帧快照）➔ 优雅停机 11 域存档 ➔ 单例反装配。 | 全链路成功跃迁，耗时 < 500ms；首帧快照派发一次；存档落盘；反装配零残留。 | `Inv-HDS4-1` |
| **`TC-HDS-07`** | **前端零入侵安全审计**<br>Git diff 与前端目录文件哈希。 | `frontend/` 改动数 == 0。 | `Inv-HDS-5`<br>`Inv-HDS4-2` |
| **`TC-HDS-08`** | **全域回归与内存泄漏守卫**<br>全量测试套件 + 对象池/RID 检测。 | 既有 93+ 套全 PASS；0 ObjectDB 泄漏、0 CanvasItem RID 悬挂；新增套件经 registry 与 arch guard 登记校验。 | `Inv-HDS2-2` |

---

## 三、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 4.1: 护栏套件编写与注册** - 8 大用例实现；挂载 `tests/test_registry.gd` 下一空槽并同步 `get_all_test_classes()`/TC-ARCH-03 登记。
- [ ] **Step 4.2: 全域回归与门禁闭环** - 全域测试 100% PASS；`audit-all`（含 audit_config_ssot / audit_copywriting / audit_config_unused / audit_gd_style）全绿；audit-docs baseline 0 新增。
- [ ] **Step 4.3: 防臆造与契约白名单注入验证** - 人为向快照注入 mp/level 字段 → 编译/断言即红（防臆造生效）；移除 payload args → 叙事渲染契约断言即红。
- [ ] **Step 4.4: 与 P70/演进02 协同闭环登记** - 依执行顺序（P70 → P71 → 演进02）确认无同文件并发；路线图总索引登记 Phase 71 完成（第 07 期 7/10），演进02 仍为已授权 Backlog。

---

## 四、 全量工程验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S4-01` | 全域单测 100% PASS | 全量 test_runner 执行 | 既有 93+ 套全过；新增套件 8 用例全 PASS |
| `TC-HDS-S4-02` | 真实溯源与防臆造 | 快照字段溯源核查 + 注入反例 | 0 臆造字段；注入 mp/level 断言即红 |
| `TC-HDS-S4-03` | 广播契约完备 | payload args/category_key 全检 | 0 条缺 args/category_key 的广播 |
| `TC-HDS-S4-04` | 门禁链全绿 | `audit-all` + audit-docs | 0 error；baseline 0 新增 |
| `TC-HDS-S4-05` | 前端零入侵 + 协同登记 | git diff + 路线图总索引 | frontend/ 0 改动；Phase 71 登记完成（07 期 7/10），演进02 维持 Backlog |
