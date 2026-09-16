# Phase 88 修复实施报告：架构角色归位与存档韧性残余治理

**日期**：2026-09-13（早上 09:47）
**工作流**：工作流 5（技术债治理）→ 工作流 1（修复后复查）
**案卷**：`docs/路线图/01_短期施工区/Phase_88_架构角色归位与存档韧性残余治理施工细则/`（阶段1~4）
**授权记录**：用户批准「6 项全部改码」+ `A1` 修法「角色重分类」

---

## 📌 TL;DR

- **整体结论**：`A1` 与 `A5` 已实施并通过**正向 + 负向可证伪**双重验收；`A4` **以证据结案（不做改码）**；`A2`/`A3`/`A6` 等给出明确去向。
- **关键纠偏**：分诊复核发现报告原口径存在**计数失真**——`A1`「11 处」含大量合法自身状态变更，真实违规仅 4 文件；`A4`「4 处循环内堆分配」经代码级核验**全部不在热路径循环**。
- **实测结果**：门禁 **20/20 PASS**；测试 **770/770**（109/109 套，较上轮 +2）；语法门禁通过；架构护栏 **TC-ARCH-01~07 全 PASS**；文档 **新增违规 0**。
- **负向可证伪**：关闭 `recovery` 两开关 → **768/770**，失败项恰为 `TC-SV-37`/`TC-SV-38`。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🟢 **通过**（五道门禁全绿 + 负向可证伪成立） |
| 实施项 | `A1`（3 文件角色归位 + 1 处混合角色拆分）、`A5`（存档自愈闭环 + 2 条契约测试） |
| 结案项 | `A4`（4 处经代码级核验均非热路径，依「判据先于改动」结案） |
| 去向登记 | `A2`→ADR；`A3`→演进 02；`A5`残留(`cdkey`)→角色归位批次；`A6`/`A7`→测试基建 |
| 建议下一步 | 评审后提交；`A2` 先出 ADR 再实施 |

---

## 一、 实施内容

### 1.1 `A1` 架构角色归位（`Inv-P88-2/3`）

| 对象 | 变更 |
|---|---|
| `seal_solver.gd` → **`seal_fsm.gd`** | 类名 `SealSolver` → **`SealFsm`**（含 `.uid` 同步 `git mv`）；题头架构定位更正为 `Domain FSM / State Advancer`。依据：其函数动词已是 `apply_*`（README 中 fsm 语义），且改写注入的 `seals` 状态。引用面：`test_magic_system.gd`（已同步） |
| `red_dot_tree_solver.gd` → **`red_dot_tree_fsm.gd`** | 类名 `RedDotTreeSolver` → **`RedDotTreeFsm`**（含 `.uid`）；题头更正。依据：原地改写注入的 `registry` 与节点对象。引用面：`test_notification_red_dot.gd` + `test_log_error_base_pipeline.gd` 的 push 分级白名单**精确路径键**（已同步） |
| `GenericAffixSolver.apply_elite_affixes` → **`EliteMonsterAggregate.apply_affixes`** | 混合角色拆分：改状态能力回归实体自身（entity 承载自身状态变更），求解器文件收敛为**纯函数**（仅 `get_affix` / `roll_random_affixes`）。业务侧原无调用点，测试 1 处已同步 |

### 1.2 `A5` 存档自愈闭环（`Inv-P88-4/5/7`）

| 能力 | 实现 | 配置键 |
|---|---|---|
| 孤儿临时文件清理 | `SaveManager.ensure_save_directory()` → `_cleanup_orphan_tmp_files()`：回收原子写中断遗留的 `*{tmp_suffix}`，计数 > 0 时告警留痕 | `recovery/orphan_tmp_cleanup`（默认 true） |
| 正档损坏自动恢复 | `SaveManager.load_game()` 损坏类失败路径 → `_fail_or_recover()`：`.bak` 存在则自动恢复并重读，成功后结果携带 `auto_restored=true` + `recovered_from` | `recovery/auto_restore_enabled`（默认 true） |
| 递归深度上限 | `static var _recovering` 守卫，深度硬上限 **1**，防 `.bak` 亦损坏时无界递归 | — |
| 失败语义不美化 | 仅 `CHECKSUM_MISMATCH` / `JSON_PARSE_FAIL` / `INVALID_ENVELOPE` 触发；版本方向闸门与文件缺失不参与；恢复/重读失败一律回退**原始** `error_code` | — |

### 1.3 契约测试（延续既有同域文件，不新建测试文件）

- `TC-SV-37`：孤儿 `.tmp` 启动回收（`test_save_consistency_recovery.gd`）
- `TC-SV-38`：正档损坏 → 自动从 `.bak` 恢复并重读，恢复内容为**上一代正档**（`round == 1`）

---

## 二、 验收证据

### 正向（五道门禁全绿）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全域静态门禁 | `bash scripts/sh/audit-all.sh` | **20 / 20 PASS**，0 Error / 0 Warn |
| 全域单元测试 | `bash run_tests.sh` | **770 / 770**（109 / 109 套） |
| GDScript 语法 | `bash scripts/sh/check-gdscript.sh` | 通过 |
| 架构护栏 | `bash scripts/sh/audit-arch.sh` | TC-ARCH-01~07 全 PASS |
| 文档四域棘轮 | `bash scripts/sh/audit-docs.sh --baseline ...` | error 0 / warn 0 / **新增违规 0** |

### 负向可证伪（`Inv-P88-10`）

| 验证项 | 手段 | 结果 |
|---|---|---|
| 存档自愈能力有效性 | 关闭 `recovery/auto_restore_enabled` 与 `recovery/orphan_tmp_cleanup` 后跑全域测试 | **768 / 770（108 / 109 套）**，失败项恰为 `TC-SV-37` / `TC-SV-38` → 恢复开关后回到 770/770 |
| 旧名零代码残留 | 全域 grep（`backend/` `frontend/` `tests/` `config/`） | **代码引用 0 处**；仅 `generic_affix_solver.gd:6`、`:31` 两处**变更溯源注释**提及旧名 |

---

## 三、 关键纠偏：两项报告口径失真

| 项 | 原口径 | 复核结论 |
|---|---|---|
| `A1` solver mutator | 「11 处」 | **失真**：11 处系粗粒度 grep 命中全域 `-> void`，含 aggregate/entity 的 `_init` / `add_*` / `dispose` / `reset_for_tests` 等**合法的自身状态变更**。按 `Inv-P88-2` 收敛后，真实违规为 **4 文件**（`seal` 3 处 + `generic_affix` 1 处 + `red_dot_tree` 3 处 + `cdkey` 1 处） |
| `A4` 循环内堆分配 | 「4 处违 ADV-PRF-002」 | **失真**：`error_code_registry.gd:44` 与 `redaction_rule.gd:65/84` 位于**版本守卫下的配置加载期**（一次性）；`game_mode_routing_solver.gd:58` 在函数入口、`:111` 在 `if` 分支，**均不在循环内**；`log_query_service.gd:100` 在分页循环内但属**刻意的深拷贝隔离**。按 `ADV-PRF-002` 的热路径适用范围，**4 处均不成立** → 以证据结案 |

---

## 四、 未实施项去向登记

| 编号 | 项 | 去向 | 原因 |
|---|---|---|---|
| `DEF-P87-A2` | `fsm` 跨聚合编排 32 处 | **转 ADR 设计件** | 正确修法为抽至 `pipeline` 编排，属跨域职责重划；无 ADR 直接改会造成编排权归属歧义 |
| `DEF-P87-A3` | 前端上帝对象（1015 / 949 行） | **转演进 02 协同批次** | 拆分需视图节点结构与快照契约联动；演进 02 将重写这些视图的数据注入路径，先拆分导致二次返工 |
| `DEF-P87-A4` | 循环内堆分配 4 处 | **证据结案** | 见 §三；臆测改动无收益却引入回归风险 |
| `DEF-P87-A5`（残留） | `cdkey_redemption_solver._record_failure` 可变级联 | **角色归位专项批次** | 归位需连带重构公开方法签名与全部调用方，属半程重构；本卷按「最小面」只做零级联的两个文件与一处拆分 |
| `DEF-P87-A6` | `ObjectDB` 泄漏 68 实例 | **测试基建批次** | 测试基建质量项，不影响业务正确性；定位需逐套件 `--verbose` 归因 |
| `DEF-P87-A7`（新） | `test_latest.json` 的 `ok` 字段语义反直觉（`ok: 0` 表示通过） | **测试基建批次** | 改字段语义会破坏既有消费方，需先确认消费面 |

---

## 五、 变更清单

**修改 41 文件（+466 / −87）**，其中本轮（Phase 88）核心变更：

- 重命名：`seal_solver.gd{,.uid}` → `seal_fsm.gd{,.uid}`；`red_dot_tree_solver.gd{,.uid}` → `red_dot_tree_fsm.gd{,.uid}`（`git mv` 保历史）
- 后端：`elite_monster_entity.gd`（新增 `apply_affixes`）、`generic_affix_solver.gd`（移除 mutator + 题头更正）、`save_manager.gd`（孤儿清理 + 自动恢复 + 两个内部助手）
- 配置：`config/infrastructure/persistence.json`（新增 `recovery` 段与 2 条文案）
- 测试：`test_elite_mutation.gd`、`test_magic_system.gd`、`test_notification_red_dot.gd`、`test_log_error_base_pipeline.gd`、`test_editor_hot_reload.gd`、`test_save_consistency_recovery.gd`
- 文档：Phase 88 案卷（4 份）+ `路线图总索引.md`（第 09 期 4/10）

**顺带修正**：Phase 87 新增用例 `TC-SV-28/29` 与既有用例**跨文件重号** → 顺延为 `TC-SV-35/36`，同步 4 处文档引用。

---

## ⚠️ 待完善 / 已知局限

1. **未提交**：所有改动已落盘并验证，但**未执行 `git commit`**（按项目规范待你确认）。注意 3 个 `.gd.uid`（前端测试）为首次导入产物，应与源码一并提交。
2. **`A5` 自动恢复的行为变更**：默认开启后，正档损坏时会自动以 `.bak` 覆盖正档。这是刻意的玩家保护行为，且受配置开关控制；若业务上要求「先提示后恢复」，把 `recovery/auto_restore_enabled` 改为 `false` 即可退回原语义。
3. **跨平台原子性未验证**：`DirAccess.rename_absolute` 覆盖已存在文件在 Windows/Linux 的原子性差异仍未实测（沿用既有实现，本卷未改动）。
4. **`A2`/`A3` 体量说明**：`A2` 的 32 处与 `A3` 的两个千行视图**无法在单轮内安全完成**——本卷选择交付可验证的增量而非浅层批量改动，二者已给出明确承载位置。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
> 本轮为**读写模式**：已修改 41 个工程文件、新增 2 个案卷（Phase 87 / 88，各 4 份阶段细则），全部改动经五道门禁与负向可证伪双重验收。
