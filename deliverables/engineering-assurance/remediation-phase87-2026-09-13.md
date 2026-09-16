# Phase 87 修复实施报告：门禁体系可信度恢复与工具链缺陷全量治理

**日期**：2026-09-13（早上）
**工作流**：工作流 1（代码审查）→ 工作流 3（事故响应）→ 工作流 5（技术债修复）
**案卷**：`docs/路线图/01_短期施工区/Phase_87_门禁体系可信度恢复与工具链缺陷全量治理施工细则/`（阶段1~4）
**参与成员**：Cody（代码审查师）/ Archi（系统架构师）/ Rex（SRE 工程师）/ Tessa（测试专家）/ Docu（技术文档师）
**授权记录**：用户批准「立 Phase 87 案卷并同轮实施」+ 范围「全量（含架构归位）」

---

## 📌 TL;DR

- **整体结论**：事故根因已消除，**门禁体系首次真正可复现地全绿**——且是**正向全绿 + 负向可证伪**双重验证。
- **实测结果**：静态门禁 **20/20 PASS（0 Error / 0 Warn）**；全域测试 **768/768（109/109 套）**；架构护栏 **TC-ARCH-01~07 全 PASS**；GDScript 语法门禁通过；文档门禁 **新增违规 0**。
- **变更规模**：29 个文件（+242 / −29），新增 1 个案卷（4 份阶段细则）与 2 条契约测试断言。
- **架构类残余缺陷**：6 项（`DEF-P87-A1~A6`）已**显式暂缓登记**，含原因与建议承载位置，无悬空项。

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| 整体评级 | 🟢 **通过**（门禁、测试、护栏、语法、文档五道门禁全绿） |
| 修复项 | 5 类缺陷 / 22 个实体改动点 |
| 防复发 | 新增 1 条门禁规则 + 2 条契约测试（均经负向可证伪验证） |
| 暂缓项 | 6 项（架构级职责归位与韧性演进，显式登记） |
| 建议下一步 | 评审后提交；后续按 `DEF-P87-A1~A6` 承载位置分批立项 |

---

## 一、 修复清单（按缺陷分桶）

### B-1 门禁脚本自身不可运行 → 已修复

7 个脚本补齐 `from typing import Any`（全库原无 `from __future__ import annotations`）：

| 文件 | 修复前 | 修复后 |
|---|---|---|
| `scripts/py/audit_config.py` | `NameError`（`:57`） | 退出码 0 |
| `scripts/py/audit_docs.py` | `NameError`（`:182`） | 退出码 0（error 0 / warn 0） |
| `scripts/py/audit_event_probability.py` | `NameError`（`:45`） | 退出码 0 |
| `scripts/py/audit_config_unused.py` | `NameError`（`:76` 嵌套函数） | 退出码 0 |
| `scripts/py/audit_event_channels.py` | `NameError`（`:74` 嵌套函数） | 退出码 0 |
| `scripts/py/archive/inspect.py` | `NameError`（`:123`） | 归档链恢复 |
| `scripts/py/archive/links.py` | `NameError`（`:41`） | `archive_volume.py --help` 退出码 0 |

### B-2 运行时契约脱节 → 已修复

`.github/workflows/godot-ci.yml`：新增 `actions/setup-python@v5`（`python-version: '3.12'`）步骤；修正全量审查步骤名失实计数（「7 项 python 审计」→「20 项静态门禁」）。

### B-3 入口路径不可移植 → 已修复

11 个脚本的根目录解析改为 `{ pwd -W 2>/dev/null || pwd; }`（MSYS 输出 `C:/...`，非 MSYS 自动回退），覆盖 `test-run.sh`、`audit-all.sh`、`audit-arch.sh`、`audit-docs.sh`、`audit-perf.sh`、`bench-run.sh`、`bench-sweep.sh`、`check-gdscript.sh`、`check-mermaid.sh`、`package-webgames.sh`、`archive-volume.sh`。

### B-4 引用语义误用 → 已修复

`backend/infrastructure/game_config.gd:163`：`_tables` → `_tables.duplicate(true)`，恢复 `reload_config()` 的四个契约（原子交换 / 失败回滚 / 必需表拒发布不污染运行快照 / 变更集驱动缓存失效）；原死代码分支 `:205` 恢复可达。

### B-5 安全出口旁路 → 已修复

`backend/infrastructure/error_reporter.gd`：`record.context` 改为经 `RedactionRule.apply(context)` 产出，与规范链路 `LogCollector.log()` 对齐，消除「凭证经 `ErrorReporter → EventBusCore → LogFileExporter` 明文落盘」缺口。

### 防复发（单源演进，不新建门禁文件）

- `scripts/py/audit_script_comment.py`：新增 `PY-ANNOTATION-IMPORT` 规则（AST 扫描注解引用的 typing 名字绑定完备性；`from __future__ import annotations` 免检）。
- `tests/unit/infrastructure/test_editor_hot_reload.gd`：新增 `TC-SV-35`（变更集精准识别）、`TC-SV-36`（拒绝发布时保留旧运行快照与版本）。

### 文档单一真源校正

`README.md`、`scripts/README.md`、`tests/README.md`、`config/README.md`、`project.godot`：校正 11 处失实计数/引用（测试套件 109、测试项 768、全域 `.gd` 513 / 62,461 行、backend 302 / 26,688 行、配置表 123、配置调用点 862、文案表 49、`domains` 登记示例路径、移除 `project.godot` 易变阶段号）。

---

## 二、 验收证据（正向 + 负向）

### 正向：五道门禁全绿

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全域静态门禁 | `bash scripts/sh/audit-all.sh` | **20 / 20 PASS**，0 Error / 0 Warn，退出码 0 |
| 全域单元测试 | `bash run_tests.sh` | **768 / 768**（109 / 109 套），退出码 0 |
| 架构护栏 | `bash scripts/sh/audit-arch.sh` | TC-ARCH-01~07 全 PASS，退出码 0 |
| GDScript 语法 | `bash scripts/sh/check-gdscript.sh` | 通过，退出码 0 |
| 文档四域棘轮 | `bash scripts/sh/audit-docs.sh --baseline ...` | error 0 / warn 0 / **新增违规 0**，退出码 0 |

### 负向：可证伪验证（防假绿）

| 验证项 | 手段 | 结果 |
|---|---|---|
| 热重载契约测试有效性 | 临时回退 `game_config.gd:163` 后跑全域测试 | **766 / 768（108 / 109 套）**，恰好 `TC-SV-35`/`TC-SV-36` 转红 → 恢复后回到 768 / 768 |
| 防复发规则有效性 | `_check_py_annotation_bindings` 正反例矩阵（顶层/嵌套/字典返回/惰性注解/局部导入） | **6 / 6 符合预期** |
| 规则在真实树零误报 | `python3 scripts/py/audit_script_comment.py` | 74 份脚本 0 违规，退出码 0 |

---

## 三、 暂缓登记（架构类残余缺陷，显式留痕）

| 编号 | 缺陷 | 严重度 | 暂缓原因 | 建议承载位置 |
|---|---|---|---|---|
| `DEF-P87-A1` | `solver` 违反「禁 mutator」11 处 | 🟡 | 角色职责归位需分批立卷 + 按域回归 | 后端角色归位专项卷 |
| `DEF-P87-A2` | `fsm` 跨聚合编排 32 处 | 🟡 | 需先立 ADR 再实施 | 架构 ADR + 角色归位卷 |
| `DEF-P87-A3` | 前端上帝对象（1015 / 949 行视图） | 🟡 | 与演进 02（前端事件接线）强耦合 | 演进 02 协同批次 |
| `DEF-P87-A4` | 循环内瞬态堆分配 4 处 | 🟡 | 须先有 benchmark 证据；与演进 03 对象池协同 | 演进 03 协同批次 |
| `DEF-P87-A5` | 存档自愈缺口（`restore_backup` 无生产调用、`.tmp` 无锁、单代 `.bak`） | 🟠 | 涉持久化契约变更与降级语义设计 | 持久化韧性专项卷 |
| `DEF-P87-A6` | `ObjectDB` 泄漏告警（68 实例 / 1 RID / 9 resources） | 🟢 | 测试基建质量项，不影响业务正确性 | 测试基建治理批次 |

> 上述项均**非本轮事故成因**，按「先恢复可验证性、后推进架构演进」原则暂缓，避免在门禁刚恢复时引入高风险重构。

---

## 四、 变更清单（git status）

**修改 29 文件（+242 / −29）**：`.github/workflows/godot-ci.yml`、`.gitignore`（新增 `sarif/` 忽略）、`WebGames/{README.md,project.godot,config/README.md,scripts/README.md,tests/README.md,docs/路线图/路线图总索引.md}`、`scripts/py/` 7 个缺陷脚本 + `audit_script_comment.py`、`scripts/sh/` 11 个脚本、`backend/infrastructure/{game_config.gd,error_reporter.gd}`、`tests/unit/infrastructure/test_editor_hot_reload.gd`。

**新增**：`WebGames/docs/路线图/01_短期施工区/Phase_87_.../`（4 份阶段细则）、本报告。

**附带产物（首次 `godot --headless --import` 生成，应按仓库既有惯例入库）**：`WebGames/tests/unit/frontend/test_frontend_{error_domain,robustness,ui_state_and_mock}.gd.uid`。

---

## ⚠️ 待完善 / 已知局限

1. **未提交**：本报告仅落盘与验证，未执行 git commit（按项目规范，提交需你确认）。
2. **`test_latest.json` 的 `ok` 字段语义反直觉**（`ok: 0` 表示通过）——属既有实现，本轮未改动以免破坏消费方；建议后续专项修正并登记。
3. **CI 真值未远端验证**：`setup-python` 修复在本机推演成立，但未经 GitHub Actions 实跑确认（需一次 push 或 `workflow_dispatch`）。
4. **`.uid` 新增文件**：3 个前端测试的 `.uid` 为 Godot 首次导入产物，需与源码一并提交方可保持类缓存稳定。
5. **暂缓项未闭环**：`DEF-P87-A1~A6` 仅登记，未实施。

---

## 📚 数据来源 & 成员产出索引

| 成员 | 本轮贡献 |
|---|---|
| **Cody**（代码审查师） | 7 文件爆炸半径取证；契约混搭/性能热点/角色红线清单（转入暂缓登记） |
| **Archi**（系统架构师） | 热重载别名缺陷独立复核（项目外 Godot 探针 PROBE1~5）；架构护栏与耦合结论 |
| **Rex**（SRE 工程师） | 事故响应六阶段全流程；SEV 分级；遏制措施分档（区分运维动作与须获批改动） |
| **Tessa**（测试专家） | 109/109 套、766/766 项真值；`pwd` 路径 bug 定位；门禁可复现性判定 |
| **Docu**（技术文档师） | 文档声明 vs 真值对照表（9 项）；死链定位；暂缓项承载位置建议 |

**主理人独立复核（trust-but-verify）**：7 文件逐一复测；隔离复测推翻 `arch` 300s 超时伪红；独立复核 Godot 探针产物；实测两条入口退出码；逐条复核文档数字；复核并采纳 Docu 对「90+」出处的更正；复核并推翻「`godot-ci.yml` 不存在」的成员断言。

---

> 本报告由工程保障团队 AI 协作生成，关键决策请由人类工程负责人复核。
> 本轮为**读写模式**（修复实施）：已修改 29 个工程文件并新增 1 个案卷；全部改动经五道门禁与负向可证伪双重验收。
