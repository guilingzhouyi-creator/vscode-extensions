# 卡拉尔世界引擎（WebGames）全面工程审查 + 事故响应报告

**日期**：2026-09-13
**工作流**：工作流 1（综合代码审查）+ 工作流 3（事故响应）+ 工作流 5（技术债评估）
**审查对象**：`WebGames/`（Godot 4.7.2「无头确定性母机 + 解耦表现宿主」，backend 47 领域 / frontend 17 视图）
**参与成员**：Cody（代码审查师）/ Archi（系统架构师）/ Rex（SRE 工程师）/ Tessa（测试专家）/ Docu（技术文档师）
**审查性质**：**只读**。全程未修改任何工程文件（唯一写入为 `godot --headless --import` 生成的 `.godot/` 缓存与 `tests/reports/` 报告目录，二者均在 `.gitignore` 内）

---

## 📌 TL;DR（执行摘要）

- **整体结论**：**业务代码质量健康，质量保障机制整体失效**。GDScript 全量静态审计（hardcode / perf / bounds / cdc / arch / secrets）全部退出码 0，全域单测 109 套 / 766 项 100% 通过；但守护这一切的**门禁体系本身已崩溃**，且此前的「全绿」声明不可复现。
- **严重度分布**：🔴 严重 **7** 项 / 🟠 高 **10** 项 / 🟡 中 **14** 项 / 🟢 低 **9** 项
- **阻塞 / 非阻塞**：**阻塞**（7 项 🔴，含 2 项可导致静默数据/配置错误）
- **最高严重度 Top1**：全域静态质量门禁体系系统性失效——`scripts/py/` 下 **7 个脚本使用 `Any` 却未 `from typing import Any`**，导致 `audit_runner.py` 实测 **20 项中 5 项崩溃**（`TOTAL=20 / PASS=15 / FAIL=5`，退出码 1）
- **已排除项**：首轮聚合中 `arch` 项报 300s 超时，经**隔离复测**判定为并发伪红（单跑 `audit_arch.py` → 退出码 0 / 19 秒 / TC-ARCH-01~07 全 PASS），**不纳入事故**
- **用户特别约束已遵守**：`frontend/` 与 `backend/` 不直连的**有意设计**未被列为缺陷，且经实测**零越界**（详见 §1.5）

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🔴 **不通过**（业务码通过，保障机制不通过） |
| 阻塞项数量 | 7 |
| 关键行动项 | 9 条（P0×3 / P1×3 / P2×3） |
| 事故等级 | SEV4（无用户可见影响），**建议按 SEV3 响应节奏处置** |
| 建议下一步 | ①CI 补 `actions/setup-python`；②7 文件补 typing 导入；③`game_config.reload_config()` 别名缺陷立细则修复 |

---

## 一、按严重程度排序的风险与问题清单

> 每条均标注**证据**（可复现命令 / 真实退出码 / `文件:行`）与**验证状态**。
> 【直证】= 主理人独立实测复核；【成员实证】= 成员给出可复现命令与输出；【静态】= 静态判定未运行期复现。

### 🔴 严重（7 项）

#### [TD-001] 门禁体系系统性失效：7 个脚本缺 `Any` 导入，20 项门禁中 5 项崩溃 【直证】

**证据（隔离复测，无并发干扰）**

```bash
python3 -X utf8 scripts/py/audit_runner.py
# → EXIT=1  TOTAL=20  PASS=15  FAIL=5
# FAIL config / config_unused / event_probability / event_channels / docs
# 全部 NameError: name 'Any' is not defined.
```

| 文件 | `Any` 引用 | typing 导入 | 崩溃时机 | 注册门禁（audit_runner.py 行号） |
|---|---|---|---|---|
| `audit_config.py` | 5 | ❌ 无 | `:57` 模块级函数注解 → **import 期** | `config`（:83） |
| `audit_docs.py` | 5 | ❌ 无 | `:182` 类方法签名 → **import 期** | `docs`（:202） |
| `audit_event_probability.py` | 2 | ❌ 无 | `:45` 模块级函数注解 → **import 期** | `event_probability`（:167） |
| `audit_config_unused.py` | 1 | ❌ 无 | `:76` **嵌套函数**注解 → 运行期 | `config_unused`（:118） |
| `audit_event_channels.py` | 1 | ❌ 无 | `:74` **嵌套函数**注解 → 运行期 | `event_channels`（:181） |
| `archive/inspect.py` | 1 | ❌ 无 | `:123` → 归档链 | — |
| `archive/links.py` | 1 | ❌ 无 | `:41` → 归档链 | — |

- 全库**无** `from __future__ import annotations`（`grep` 0 命中）→ 注解在函数/类定义时立即求值。
- 受连带影响：`python3 scripts/py/archive_volume.py --help` → **EXIT=1**，归档卷工具链不可用。
- 脚本头均声明「运行时: Python 3.10+」，实际 **3.10–3.13 一律崩溃**（3.14 因 PEP 649 惰性注解才幸免）→ 声明的运行时契约与实际不符。
- **后果**：`audit_config` 原本拦「配置表结构 / 必需表齐备 / 键命名」，`audit_docs` 原本拦「文档四域 / 命名 / 死链 / 基线棘轮」，`event_channels` 原本拦「EventBus 频道纪律与叙事契约」，`event_probability` 原本拦「事件流动态概率配置」，`config_unused` 原本拦「死配置」——**这五类缺陷当前全部无人拦截**。

**建议修复**：7 个文件各补 1 行 `from typing import Any`（零逻辑风险、最小改动）。

#### [TD-002] 配置热重载四契约失效：坏配置热重载后业务静默回退代码默认值 【直证 + 成员实证】

**位置**：`backend/infrastructure/game_config.gd:162-244` `reload_config()`
**根因**：Godot `Dictionary` 是**引用类型**，`:163 var old_tables: Dictionary = _tables` 使二者**同体**。

**实测证据**（项目外最小 Godot 工程 `%TEMP%/gd_alias_probe`，未触碰 WebGames 任何文件）

```
PROBE1 b={ "y": 2 }        b_has_y=true  b_has_x=false      → 确证引用(别名)语义
PROBE2 old_tables={ "new.key": { "k": 2 } }
       built     ={ "new.key": { "k": 2 } }
       tables    ={ "new.key": { "k": 2 } }                  → "还原旧表"未还原，旧快照未保留
PROBE3 added=[] changed=[] removed=[]                        → 变更集恒空
PROBE4 branch=false                                          → 空结果回滚分支为死代码
```

来源：`_scan_dir:397-411` → `_load_table:425 _tables[table_name] = data` **就地写入同一对象**，全程无独立构建目标。

| 契约 | 判定 | 说明 |
|---|---|---|
| ① 成功路径原子交换 | **实质失效** | 无独立构建对象，`:233 _tables = built` 为同体空操作；结果正确仅因"全程同体" |
| ② 失败路径回滚保留旧快照 | **失效** | `:168 _tables.clear()` 已摧毁旧快照，`:171`/`:192` 的"还原"是空操作 |
| ③ 必需表缺失拒绝发布 | **半失效** | `success:false` 信号正确返回，但**污染已发生**——它要防的「业务静默回退代码默认值」（`:121` 注释明示）仍会发生；目录不可达时 `_tables` 变空、全表判缺失 |
| ④ 变更集驱动静态缓存失效 | **部分失效** | 版本号路径成立（`_reload_counter` 递增，消费者 `error_code_registry.gd:37`、`event_bus_core.gd:264` 用 `config_reload_version()` 比对）；但 `config.security_reloaded` 载荷 `changed` **恒为 `[]`**（当前无监听者消费，属**潜伏**契约失效） |

**为什么测试没拦住**：`test_version_governance_pipeline.gd:187-196` 仅断言 success + 版本单调递增；`test_performance_and_scalability_pipeline.gd:255-268` 仅 happy path；`test_editor_hot_reload.gd:160-167` 断言"不触发全量重载"。**无任何用例注入坏配置并断言「旧快照保留 + success=false + 版本不变」→ 契约 ②③ 零覆盖。**

**建议修复**：最小一行 `:163` → `var old_tables: Dictionary = _tables.duplicate(true)`；更彻底方案为 `_scan_dir/_load_table` 增加 target 形参，构建到独立局部字典后一次赋值（零深拷贝、真原子）。

#### [TD-003] CI 未固定 Python 版本，配置门禁步骤恒红 【直证】

**证据**：`.github/workflows/godot-ci.yml` **无** `actions/setup-python`；`:94` 直接 `python3 scripts/py/audit_config.py --strict`，`:109` 调 `audit-all.sh`。
在 ubuntu-latest 默认 Python（3.12）下二者必然崩溃 → 重试 2× 后仍 exit 1 → **每次 push 触及 `WebGames/**` 整条流水线必红**。
**后果**：alert fatigue → 团队习惯性绕过 → 合并门禁名存实亡。

#### [TD-004] `.pre-commit-config.yaml` 钩子恒错 + 官方 SOP 自锁 【直证】

`.pre-commit-config.yaml:18` 钩子 `audit-docs` 调 `python scripts/py/audit_docs.py --json` → 因 TD-001 必然崩溃。
且 `WebGames/docs/README.md` 规定的 Agent SOP **步骤 2** 就是跑 `audit-docs.sh --json` → **官方流程自锁**：按规范操作必然失败。
配合 `fail_fast: true`，任何触碰 `docs/**` 的提交都被阻断 → 开发者被迫 `--no-verify`。

#### [TD-005] 文档化门禁入口在 Windows 开发平台不可用 【直证】

| 入口 | 实测 | 错误 |
|---|---|---|
| `bash run_tests.sh`（AGENTS.md 规定的 DoD 验收入口） | **EXIT=1** | `Invalid project path specified: "/c/Users/.../WebGames", aborting` |
| `bash scripts/sh/audit-all.sh`（20 项门禁一键入口） | **EXIT=2** | `can't open file 'C:\c\Users\...\audit_runner.py': No such file or directory` |

**根因**：`scripts/sh/test-run.sh:17`（与 audit-all.sh 同构）`ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"` 在 Git Bash 下产出 MSYS 路径 `/c/...`，直接传给原生 Windows 的 `godot.exe` / `python3.exe`。
**影响**：本机为 `win32`，即 README 与 AGENTS.md 反复引用的两条「一键门禁」命令在开发者实际平台上**无法复现**。
**建议修复**：`ROOT_DIR` 改 `pwd -W` 或 `cygpath -w` 归一；需先立四阶段细则获批。

#### [TD-006] 可观测性黑洞 + 日志脱敏接线缺口 【直证 + 成员实证】

- **无告警通道**：全仓 webhook / sentry / prometheus / runbook **0 命中**；`SYSTEM_HEARTBEAT_TICK` 信道**有定义但零发送** → 运行期停滞不可检测。
- **日志默认不落盘**：`config/infrastructure/log.json` → `export.enabled = false`（默认）→ 日志仅存内存环 **1000 条**，崩溃/重启全丢；`LogRetentionCleaner.sweep` 仅测试调用，运行期从不触发。
- **脱敏接线不全（安全相关）**：`RedactionRule.apply` **仅**在 `backend/infrastructure/log_collector.gd:79` 一处调用；而 `LogFileExporter._append_to_file`（`log_file_exporter.gd:78`）**无任何脱敏处理** → 一旦启用导出，经 `ErrorReporter → EventBusCore.emit_log_record → LogFileExporter` 路径的 token/secret 可**明文落盘**。
- **级别不统一**：`UnifiedLogger` 有 CRITICAL/FATAL，导出与环仅 DEBUG/INFO/WARN/ERROR，CRITICAL 被降级为 ERROR；模块头宣称的「FATAL/ERROR 告警信号」**不存在**。
- **本条正是 TD-001 长期潜伏的制度性原因**：门禁崩溃是**静默失败**，无差异化信号、无「门禁通过率」阈值告警，只能靠人工撞见。

#### [TD-007] 文档量化声明全面漂移，且守护漂移的门禁已失效 【直证】

| 声明（出处） | 声明值 | 实测真值 | 判定 |
|---|---|---|---|
| 全域 `.gd` / 行数（`README.md:197`） | 443 / ~49,697 | **513 / 62,386** | ✗ |
| backend `.gd` / 行数（`README.md:197`） | 303 / ~22,994 | **302 / 26,683** | ✗ |
| 测试套件（`README.md:8`、`:199`） | 「90+」 | **109** | ✗ |
| 测试项（`README.md:199`） | 714 | **766**（归档值；`tests/reports/test_latest.json` 不存在，无法实时核） | ✗ |
| 测试套件（`tests/README.md:155`） | 「110+」 | **109** | ✗ |
| 配置表（`README.md:200`） | 125 | **123**（`find config -name '*.json'`） | ✗ |
| narratives 表（`config/README.md:38`） | 50 | **49** | ✗ |
| 阶段数（`project.godot:10`） | 「52阶段」 | 路线图已至 **Phase 86** | ✗ |
| 测试套件（`scripts/sh/test-run.sh:7`） | 109 | 109 | ✅ 唯一正确 |

**关键**：`README.md:197`「质量现状」6 项数字**零门禁守护**——而本应守护它们的 `audit_config` / `audit_docs` 恰好是 TD-001 中崩溃的两项 → 漂移必然静默发生。

---

### 🟠 高（10 项）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| TD-008 | **存档自愈缺失**：`save_manager.gd` 的 `restore_backup` **无生产调用**（仅测试）→ 损坏档无降级/自愈路径 | 【成员实证】grep 全文 | 在 load 失败路径接入 `.bak` 自动恢复 + 告警 |
| TD-009 | **`.tmp` 无锁**：固定 `.tmp` 文件名，多实例并发同槽共用 → 存在发布损坏档窗口；仅保留 1 代 `.bak`；孤儿 `.tmp` 无启动清理 | 【成员实证】`save_manager.gd:53` | tmp 名带 pid/随机后缀；启动清理孤儿 tmp |
| TD-010 | **叙事文案契约**：`log.json` `redaction.enabled` 已配置，但导出路径未接线（见 TD-006）；`config/README.md:121` 权威示例路径 `res://tests/unit/test_inventory.gd` **不存在**（真实路径为 `tests/unit/domains/test_inventory.gd`） | 【直证】`ls` 实测 | 修正示例路径；导出路径接入脱敏 |
| TD-011 | **结果字典契约混搭**：`save_manager.gd:221-228` `_fail` 用 `"error"` 而非 `"error_message"`，与 `error_code` 混用；`respec_pipeline.gd:37`、`gm_command_catalog.gd:45/51/57/63`、`sandbox_cheat_solver.gd:20` 返回 `{success, reason}`（`success` 属新契约、`reason` 属存量 `{valid,reason}`），两侧契约皆不符 | 【成员实证】文件原文 | 渐进归位至 `{success,error_code,error_message,data?}` |
| TD-012 | **循环内瞬态堆分配**（违 `ADV-PRF-002`）：`error_code_registry.gd:44`、`game_mode_routing_solver.gd:29`、`redaction_rule.gd:65/67`、`log_query_service.gd:100` | 【成员实证】`audit_perf_hotspots.py` | 预分配 / 复用 / 池化 |
| TD-013 | **单测可复现入口失效** → `tests/reports/` 从未生成，README 承诺的"实时数据以 `test_latest.json` 为准"落空 | 【成员实证】直跑 godot 可 109/109 通过，但入口脚本失败 | 同 TD-005 |
| TD-014 | **断言粒度不足**：6 个 pipeline 文件硬编码 `"passed": true` 共 **58 处**（如 `event_bus2` 12 处、`log_error_base` 23 处），呈"走到末尾即通过"形态，缺正向取值断言 | 【成员实证】grep | 补期望值断言，取消末端恒真 |
| TD-015 | **ObjectDB 泄漏告警**：测试退出报 **68 个 ObjectDB 泄漏 / 1 RID / 9 resources in use**，与 `test_runner.gd` 注释「杜绝 ObjectDB 泄漏」矛盾 | 【成员实证】运行输出 | 定位未释放单例/节点 |
| TD-016 | **陈旧死配置**：`WebGames/.github/workflows/ci.yml` 默认 Godot **4.2.2**（工程为 4.7）、`--import \|\| true`（**把失败掩为绿**）、无超时守护，且因位于子目录从未被 GitHub 执行 | 【直证】读文件 | 删除或标注 superseded，避免误导 |
| TD-017 | **门禁缺超时守护**：`audit-arch.sh` 自身无 `timeout`（`test-run.sh` 有 180s）→ 一旦 godot 侧阻塞可无限挂起（本轮即观测到一次 300s 超时，后证实为并发干扰） | 【直证】脚本对比 | 统一加超时守护 |

---

### 🟡 中（14 项）

| # | 问题 | 证据 |
|---|---|---|
| TD-018 | **solver 禁 mutator 红线违规 11 处**：如 `elite_mutation/generic_affix_solver.gd:33 apply_elite_affixes(monster,…) -> void`、`magic_system/seal_solver.gd:76 rollback_seal`、`notification_red_dot/red_dot_tree_solver.gd:14/42` 直改入参；`organization_governance_solver.gd:60-61`、`currency_entities.gd:65/129`、`respec_pipeline.gd:36` 同类 | 【成员实证】grep + `audit_bounds.py` |
| TD-019 | **fsm 跨聚合编排**：`commission_quest/commission_fsm.gd` 同时持 Commission + OrganizationAggregate 并双改；`equipment_loadout/equipment_fsm.gd` 持 EquipmentLoadout + WearableInventory 镜像同步（fsm 中含 Aggregate 共 32 处） | 【成员实证】grep |
| TD-020 | **单一事实源被复制**：`domains.json _meta.infra_dirs_exempt` 与 `tests/.../test_architecture_guard.gd:510` 各自硬编码 3 个豁免目录 → 新增豁免需双改，否则护栏误红 | 【成员实证】 |
| TD-021 | **`TC-ARCH-05` 覆盖不足**：仅校验 `README.md` 与 `config/README.md` 的领域计数（均 47 ✓），`project.godot:10` 描述与 `docs/README.md` 卷数不在任何门禁内 → 静默漂移（对应 TD-007） | 【成员实证】 |
| TD-022 | **前端侧无确定性门禁**：`TC-ARCH-04` 仅扫 `backend/`；`frontend/domain_boundary/mocks/` 有 8 处 `rng.randf/randi_range`（实例方法，非裸调用，风险低） | 【成员实证】 |
| TD-023 | **前端上帝对象**：`frontend/views/guild_social/guild_social_view.gd` **1015 行**、`character_progression_view.gd` **949 行** | 【成员实证】 |
| TD-024 | **死链**：`docs/模板/` 下阶段附件模板的内链 `../../../../后端架构/后端架构需求表索引.md` 解析到仓库外（真死链）；`config/README.md:121` 示例路径失效 | 【成员实证】+【直证】 |
| TD-025 | **时序依赖测试**：`test_bounded_cache_and_idempotency.gd:92` 用 `OS.delay_msec(70)` 测 TTL → 潜在 flake | 【成员实证】 |
| TD-026 | **fixtures 工厂复用率极低**：`tests/fixtures/factories/` 仅 1 个工厂、仅 1 个用例消费 | 【成员实证】 |
| TD-027 | **`.pre-commit-config.yaml` 钩子覆盖面窄**：仅覆盖 `docs/**` 与 `backend/**`，`frontend/**`、`tests/**`、`scripts/**` 无本地钩子 | 【直证】读文件 |
| TD-028 | **范式与文档不符**：`README.md` 称「每领域 3 文件（实体/求解器/状态机）」，实测**仅 3 个目录**同时具备 `_entity/_solver/_fsm`；后缀实际分布 `_solver 46 / _dto 27 / _fsm 19 / _pipeline 16 / _service 13 / _aggregate 12 / _entities 11 / _engine 11 / _entity 7` → 实际角色多于"六角色" | 【成员实证】 |
| TD-029 | **`project.godot` 描述过期**（「52阶段」）；`docs/audit/` 4 份历史报告中 2 份仍引用已过期的「46 域」，且均停在 Phase 57~86 之前 | 【直证】grep |
| TD-030 | **`audit_gd.py --strict` 阻断项**：`headless_spatial_hash_grid_3d.gd:60` 嵌套 6 层（超 `maxNestingDepth=5`）；`mock_chat_command_service.gd:1` 空包装 | 【成员实证】`--strict` EXIT=1 |
| TD-031 | **文档「基线已清零」声明不可验证**：`docs/README.md:105` 称 `summary:{errors:0,warnings:0}`，但 `audit_docs.py` 崩溃 → 该声明当前无法复现 | 【直证】 |

---

### 🟢 低（9 项）

| # | 问题 | 证据 |
|---|---|---|
| TD-032 | `save_manager.gd:53/254/263` 备份用 `DirAccess.copy_absolute`（非原子）+ `exists→copy→rename` 存在 TOCTOU 窗口；单机本地且 restore 侧已有预检，实际风险低 | 【成员实证】 |
| TD-033 | 存档 SHA-256 属**完整性**而非**真实性**（与数据同文件、可重算）；威胁模型需文档化 | 【成员实证】 |
| TD-034 | `error_code_registry.gd` 51 条错误码覆盖面尚可，但错误码与文案映射无门禁校验 | 【成员实证】 |
| TD-035 | 遥测窗口 60s 清空且**无导出** → 事故前指标不可回溯 | 【成员实证】 |
| TD-036 | RNG 共享态污染无检测：共享实例被耦合后回放/续局不可复现；建议记录种子/状态 | 【成员实证】 |
| TD-037 | 系统时钟回拨/前跳：日志与保留清理用系统时间（游戏时钟用单调计数，正确）→ 日志乱序、保留清理可能误删 | 【成员实证】 |
| TD-038 | `backend` → `frontend` 存在 1 处引用，经核为 `game_config.gd:33` **注释**，非真实依赖 | 【成员实证】 |
| TD-039 | `mock_chat_command_service.gd` 空包装类（无行为） | 【成员实证】 |
| TD-040 | `docs/audit/` 4 份报告未标注取代关系，易被当现行结论引用 | 【直证】 |

---

## 二、事故响应各阶段结论与处置建议

> **事件**：全域静态质量门禁体系系统性失效（TD-001 + TD-003 + TD-004）
> **锚定依据**：本报告中唯一同时满足「已验证 / 当前正在发生 / 阻塞交付 / 制度化失效」四项的最严重缺陷

### 2.1 事件检测与定级

| 项 | 结论 |
|---|---|
| **检测手段** | **纯人工**（本轮审查风暴发现）。CI 恒红是常态、无监控/告警通道、门禁无「自身可运行性」自检 → **无任何自动化能发现它** |
| **SEV 评级** | 按 SRE 草案属 **SEV4**（无用户可见影响的门禁/工具缺陷）；因其是 SEV1–3 的**唯一防线**且官方 SOP 自锁，**建议按 SEV3 响应节奏**（1h 内指派、当班出遏制） |
| **战情室** | 小团队免正式战情室。角色：IC = team-lead，响应者 = SRE |
| **通知对象** | 项目负责人（「先细则获批后编码」的决定权方）、CI / 工具链 owner。无对外沟通需求 |

### 2.2 影响评估

失效门禁原本拦截的内容 → 当前敞口：

| 失效门禁 | 原本拦什么 | 当前敞口 |
|---|---|---|
| `config`（`audit_config.py --strict`） | 配置表结构 / 必需表齐备 / 键命名 / 格式一致性 | 坏配置、漏删改名可进主干 |
| `config_unused` | 死配置与未引用键 | 配置腐化无人拦 |
| `docs` | 文档四域 / 命名 / 死链 / 基线棘轮 | 文档规范失守（本地提交钩子同源） |
| `event_probability` | 事件流动态概率系统 | 概率配置错误可进 |
| `event_channels` | EventBus 频道纪律与叙事契约 | 契约漂移无人拦 |
| （连带）`archive_volume` | 归档卷工具链 | 归档流程不可用 |
| CI `godot-ci.yml:94/:109` | 合并门禁 | 每次 push 整条红 → alert fatigue |
| 本地 `.pre-commit:18` | 提交门禁 | 普遍 `--no-verify` |

- **用户可见影响**：**无**。
- **是否需要回滚**：**不需要**。无任何代码变更，性质为「门禁不可信」而非线上故障。
- **发布可信度影响**：**高**。README「质量现状」与「20 项门禁全绿」在当前状态下既不可复现也无客观证据。

### 2.3 遏制措施（Containment）

> 严格遵守项目规范：**任何代码改动必须先落四阶段施工细则（数据契约→业务实现→配置驱动→验收测试）并获项目负责人批准**；护栏**单源演进、不得新建门禁文件**；**不得放宽规则或修改基线消音**。

| 档位 | 措施 | 是否需先获批 |
|---|---|---|
| **立即（分钟级，纯运维）** | ① CI workflow 层补 `actions/setup-python`，固定 3.11/3.12 锁死运行时契约；② 公告「两门禁 + 本地钩子当前恒红」，合并判断暂改人工复核 | ❌ 属 CI 运维配置 |
| **短期（小时级）** | ① 7 个文件各补 `from typing import Any`；② 把「脚本可导入性」并入**既有**门禁（`audit_script_comment` / `audit_config`），**不新建文件** | ✅ 须先立细则获批 |
| **长期** | 门禁脚本自身单测 + 解释器版本矩阵 + 「门禁通过率」阈值告警 | ✅ 须立长期演进区细则 |

### 2.4 根因分析（5 Why）

1. **门禁崩溃** → 7 个文件使用 `Any` 却未 `from typing import Any`
2. **为何未导入** → 批量化「3.10+ 注解迁移」漏 import，且无 linter / 类型检查守护脚本自身
3. **为何 7 个文件同时缺失** → Phase 85「全域脚本库规范化重构」未做逐文件 import 校验
4. **为何合并前没拦** → CI 未固定解释器、门禁脚本无自测，「声明 3.10+」与 runner 实际版本脱节
5. **制度性根因** → **门禁脚本被当「工具」而非「被测代码」**：无 owner、无测试守护、无「门禁自身可运行性」验收项

### 2.5 修复验证方案（修复后如何证明已修复）

```bash
python3 -X utf8 scripts/py/audit_runner.py          # 期望 20/20 PASS、EXIT=0（当前 15/20、EXIT=1）
python3 scripts/py/audit_config.py --strict          # 期望 EXIT=0
python3 scripts/py/audit_docs.py                     # 期望 EXIT=0 且新增违规=0
python3 scripts/py/archive_volume.py --help          # 期望 EXIT=0
bash run_tests.sh                                    # 期望 EXIT=0（需同时修 TD-005 路径 bug）
for f in <7 files>; do python3 -m py_compile "$f"; done   # 期望逐文件 EXIT=0
# CI：push 触及 WebGames/** → godot-ci 两个步骤转绿
```

**防回归**：在**既有** `audit_script_comment.py` / `audit_config.py` 内增加断言（脚本可导入 + typing 导入 / future 注解存在），**单源演进、不新增门禁文件**。

### 2.6 事后复盘

**时间线**（T0 = 本次审查发现）

| 时刻 | 事件 |
|---|---|
| T0 | 发现 5 项门禁 FAIL，同一 `NameError` |
| T0 | 确认 `archive` 链同样失效（`inspect.py:123` / `links.py:41`） |
| T0 | 隔离复测排除 `arch` 伪红（单跑 19s / EXIT=0；聚合中 300s 超时系并发干扰） |
| T0 | 响应期并发发现 `game_config.reload_config` 别名缺陷（经架构师独立复核，**确认为真实**） |

**行动项**：见 §三 行动清单。

**预防措施**

- 门禁脚本纳入单测（把「脚本自身」当被测代码）
- 工具链解释器版本固定
- CI 绿为常态，建立「门禁通过率」阈值告警
- 修复 TD-006 可观测性黑洞，使下一次「静默失败」有外部可见面

**「为什么没人更早发现」**：无告警通道 + 日志默认不落盘 + 无心跳 → 门禁崩溃是**静默失败**；CI 红无差异化信号、无阈值告警 → 失败没有外部可见面，只能靠人工撞见。

---

## 三、后续改进项及优先级

> 优先级公式（工作流 5 口径）：`Priority = (Impact + Risk) × (6 − Effort)`（Impact/Risk/Effort 取 1–5，Effort 越小得分越高）

### 行动清单（按优先级排序）

| # | 行动 | 对应缺陷 | 负责角色 | 紧急度 | 预期完成 | P 分 |
|---|---|---|---|---|---|---|
| **AC-001** | CI workflow 补 `actions/setup-python` 固定 3.11/3.12 | TD-003 | CI owner | **P0** | 当班 | (5+5)×(6−1)=**50** |
| **AC-002** | 7 个脚本补 `from typing import Any`，恢复 5 项门禁 | TD-001 | 工具链 owner | **P0** | 24h | (5+4)×(6−1)=**45** |
| **AC-003** | 立四阶段细则并获批后，修 `game_config.gd:163` 别名缺陷（`duplicate(true)` 或独立构建对象） | TD-002 | 架构 + 后端 owner | **P0** | 24h | (5+4)×(6−2)=**36** |
| **AC-004** | 修 `test-run.sh` / `audit-all.sh` 的 `pwd` POSIX 路径（`pwd -W`/`cygpath -w`），恢复 DoD 与门禁一键入口 | TD-005 / TD-013 | 工具链 owner | **P1** | 下轮 | (4+4)×(6−2)=**32** |
| **AC-005** | 把「脚本可导入性 + typing 导入」断言并入既有 `audit_script_comment.py` / `audit_config.py`（不新建门禁文件） | TD-001 防回归 | 工具链 + 测试专家 | **P1** | 下轮 | (4+4)×(6−2)=**32** |
| **AC-006** | 补热重载失败路径测试：注入坏配置，断言「旧快照保留 + success=false + 版本不变」 | TD-002 防回归 | 测试专家 | **P1** | 下轮 | (4+4)×(6−2)=**32** |
| **AC-007** | 日志导出路径接入 `RedactionRule`；开启导出时强制脱敏；`SYSTEM_HEARTBEAT_TICK` 接入心跳发送 | TD-006 | SRE + 基础设施 owner | **P2** | 下轮 | (3+4)×(6−3)=**21** |
| **AC-008** | `README.md:197` 质量现状表改机器生成（以 `test_latest.json` + `find` 统计填充，稳定标记包裹）；扩 `TC-ARCH-05` 覆盖 `.gd` 数/套件数/`project.godot` 描述 | TD-007 / TD-021 | 文档 + 架构 | **P2** | 下轮 | (3+3)×(6−3)=**18** |
| **AC-009** | 清理陈旧资产：删/标 `WebGames/.github/workflows/ci.yml`；`docs/audit/` 4 份加 superseded；修 `config/README.md:121` 与模板死链；修 `.tmp` 无锁与 `restore_backup` 无调用 | TD-008/009/010/016/024/029 | 文档 + 基础设施 owner | **P2** | 下轮 | (2+3)×(6−3)=**15** |

### 分阶段修复计划

| 阶段 | 内容 | 放行标准 |
|---|---|---|
| **第 1 阶（当班，运维级）** | AC-001 + AC-002 | `audit_runner.py` 20/20、`EXIT=0`；CI 两步骤转绿 |
| **第 2 阶（下轮，须先立细则获批）** | AC-003 + AC-004 + AC-005 + AC-006 | 热重载失败路径测试通过；两条一键入口在本机 `EXIT=0`；新增回归断言纳入既有门禁 |
| **第 3 阶（下轮起，长期演进区）** | AC-007 + AC-008 + AC-009 + TD-018~031 归位 | `audit-docs --baseline` 零新增违规；文档数字可机器复现 |

---

## 四、正面结论（须一并记录，避免以偏概全）

| 维度 | 实测结论 |
|---|---|
| **前端 ↔ 后端边界**（用户指定的有意设计） | ✅ **零越界**：`frontend/**` 引用 `res://backend` / `backend/` **0 处**；引用 `EventBusCore` **0 处**；`views` 层裸 `randf/randi/randomize` **0 处**；无 `GameConfig.get_value` 违禁调用。已有独立护栏 `tests/guards/test_frontend_boundary_guard.gd` 看守。**确认符合契约，未列为缺陷** |
| **架构护栏自身** | ✅ `audit-arch.sh` → EXIT=0；`TC-ARCH-01~07` 全 PASS（隔离单跑 19s） |
| **依赖结构** | ✅ **环形依赖 0**；最大扇出仅 2；扇入 Top1 `world_navigation(7)`；无「上帝枢纽」 |
| **全域单测** | ✅ **109/109 套、766/766 项、`[ FAIL ]` 0**（绕过 TD-005 入口路径 bug 直跑 Godot 实测，约 30s） |
| **测试拓扑合规** | ✅ `tests/unit/` 根目录散落文件 **0**；`domains.json` 47 条与 47 个领域单测**双向映射零缺失**（`audit_test_coverage.py --strict` EXIT=0） |
| **GDScript 静态质量** | ✅ `audit_hardcode` / `audit_perf_hotspots` / `audit_bounds` / `audit_cdc` / `audit_gd` / `audit_secrets` 全部 **EXIT=0**（2015 文件 0 密钥候选） |
| **确定性契约** | ✅ 业务代码零裸 `randf()/randi()`（`TC-ARCH-04` 通过） |

---

## ✅ 行动清单（对话内摘要，完整见 §三）

| # | 行动 | 负责角色 | 紧急度 |
|---|---|---|---|
| 1 | CI 补 `actions/setup-python` 固定解释器版本 | CI owner | **P0** |
| 2 | 7 个脚本补 `from typing import Any`，恢复 5 项门禁 | 工具链 owner | **P0** |
| 3 | 修 `game_config.gd:163` Dictionary 别名缺陷（须先立细则获批） | 架构 + 后端 | **P0** |
| 4 | 修脚本 `pwd` POSIX 路径 bug，恢复两条一键门禁入口 | 工具链 owner | P1 |
| 5 | 把「脚本可导入性」断言并入既有门禁 + 补热重载失败路径测试 | 工具链 + 测试 | P1 |

---

## ⚠️ 待完善 / 已知局限

1. **只读审查**：为遵守只读约定，所有修复均**未实施**；修复方向仅为建议，且须按项目规范先立四阶段细则获批。
2. **未运行 `benchmarks/` 运行时 profiling**：TD-012 等性能项为静态提示级（`audit_perf_hotspots.py` 口径），未做真实压测。
3. **`tests/README.md:155`「110+」与 README 数字**：`tests/reports/test_latest.json` 不存在（因 TD-005），766 项取自归档记录，非实时产物。
4. **`config` 表口径**：实测 123 为**文件计数**，README「125」为 `audit_config.py` 的**表口径**；因该工具崩溃，两者无法对齐。
5. **跨平台原子性未验证**：`DirAccess.rename_absolute` 覆盖已存在文件在 Windows/Linux 的原子性差异未实测。
6. **`audit_arch.py` 超时**：本轮观测到一次 300s 超时，隔离复测为 19s 通过；判定为并发干扰，但 `audit_arch.sh` 缺超时守护（TD-017）属实。
7. **领域代码未逐行通读**：采用「全量静态扫描 + solver/fsm/aggregate/save 抽样深读」，47 领域全量语义核对未做。
8. **一处成员断言已推翻**：初次回传中有「`.github/workflows/godot-ci.yml` 不存在」的断言，经复核**不成立**——该文件确实存在于仓库根 `.github/workflows/`；真实存在的是 `WebGames/.github/workflows/ci.yml`（陈旧死配置，见 TD-016）。本报告以复核结论为准。

---

## 📚 数据来源 & 成员产出索引

| 成员 | 原始产出（要点） |
|---|---|
| **Cody**（代码审查师） | 7 文件缺 `Any` 导入（逐文件行号）；`audit_runner.py` 15/20；结果字典契约混搭（`save_manager.gd:221-228`、`respec_pipeline.gd:37` 等）；循环内堆分配 4 处；solver mutator 违规；`audit_gd --strict` 阻断项 |
| **Archi**（系统架构师） | `TC-ARCH-01~07` 全 PASS；环形依赖 0；扇入/扇出 Top5；边界隔离零越界计数；`infra_dirs_exempt` 双写；**热重载别名缺陷独立复核（含项目外 Godot 探针 PROBE1~5 实测证据）** |
| **Rex**（SRE 工程师） | FMEA 关键失效路径表；可观测性缺口；存档可靠性 5 项缺口；CI 恒红判定；**SEV 分级草案 + 事故响应六阶段全流程** |
| **Tessa**（测试专家） | 109/109 套、766/766 项、`[ FAIL ]` 0 实测真值；`test_registry.gd` 109 preload 对齐验证；`tests/unit/` 根散落 0；`pwd` 路径 bug 定位；断言粒度/时序/工厂/泄漏等测试债 |
| **Docu**（技术文档师） | 文档声明 vs 真值 9 项对照表（含出处行号）；文档债四类盘点；死链定位；门禁盲区；机器生成 + 归并既有护栏的修复建议 |

**主理人独立复核记录**（trust-but-verify）

- 逐文件复测 7 个脚本的 `Any` 缺陷与真实退出码（含 `archive/inspect.py:123`、`archive/links.py:41`）
- 隔离复测 `audit_arch.py` → EXIT=0 / 19s，**推翻**「arch 项超时」为真缺陷的初判
- 独立复核 `%TEMP%/gd_alias_probe/probe_result.txt`，确认 Godot 4.7.2 `Dictionary` 引用语义
- 实测 `run_tests.sh` / `audit-all.sh` 退出码，确认 `pwd` POSIX 路径根因
- 实测文档数字：`.gd` 513、backend 302 / 26,683 行、`config` 123 JSON、`narratives` 49、`config/README.md:121` 示例路径不存在
- 复核脱敏接线：`RedactionRule.apply` 仅 `log_collector.gd:79` 一处调用；`log.json` `export.enabled=false`
- 复核并推翻一处成员断言（`godot-ci.yml` 存在性）

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
> 全程只读：未修改任何工程文件（仅生成 `.godot/` 缓存与交付报告）。
