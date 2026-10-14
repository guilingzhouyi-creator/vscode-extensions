---
档号: KALAR-DEV-2026-ST118-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST118 (MOD开发者便利套件协议同步与全链路调试推演引擎施工细则)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段3：CLI协议调试子命令与主页HUD贯通推演及脚手架升级
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 已验收 (100% PASS)
主题词/关键词: kalar-mod; dispatch; 主页HUD推演; 脚手架升级; 阶段3
---

# 施工细则：Phase 123 MOD开发者便利套件协议同步与全链路调试推演引擎 —— 阶段3：CLI协议调试子命令与主页HUD贯通推演及脚手架升级

> [!NOTE]
> **【施工目标】**：在统一 CLI 工具链门面（`kalar_mod.py`）中新增第 7 项核心子命令 `dispatch`，支持通过命令行直发或 JSON 文件载入统一请求信封并捕获回包；扩展 `play_mod.py` 突破序章终态限制，实现“创角 ➔ 序章 ➔ 主页 HUD 六大支柱快照切片”的全链路无头贯通推演；升级脚手架 `scaffold_mod.py` 与 `MOD_SPEC.md`，同步新增协议交互范例。
> **【授权依据】**：已获项目负责人明确授权——在短期施工区正式立项 Phase 123。
> **【需求溯源】**：阶段 2 协议客户端 SDK + 开发者本地 CLI 无法调试协议与无法推演主页 HUD 状态的痛点消融。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  * [阶段 1 统一协议 Schema 字典设计与真源萃取及租约对齐规范](阶段1_统一协议Schema字典设计与真源萃取及租约对齐规范.md)
  * [阶段 2 开发者轻量协议客户端 SDK 与本地模拟派发引擎实现](阶段2_开发者轻量协议客户端SDK与本地模拟派发引擎实现.md)
  * [`kalar_mod.py`](../../../../mod_sdk/tools/kalar_mod.py)
  * [`play_mod.py`](../../../../mod_sdk/tools/play_mod.py)
  * [`scaffold_mod.py`](../../../../mod_sdk/tools/scaffold_mod.py)
* **核心不变量约束断言**：
  * **Inv-CLI-SEVEN-SUBCOMMANDS-1**：`kalar-mod` CLI 门面必须严格完整支持 7 大子命令（`init`, `check`, `cook`, `preview`, `play`, `pack`, `dispatch`），每个子命令均具备 `--json` 与人类可读双模输出；
  * **Inv-PLAY-HUD-CONTINUATION-2**：`play_mod.py` 开启 `--with-hud` 参数后，序章推演结束后必须自动装配并输出对应模组创角后的首个主页 HUD 快照切片（含六大支柱与 7 大行动空间），不可妥协；
  * **Inv-DISPATCH-DRYRUN-SAFETY-3**：`kalar-mod dispatch` 默认在安全隔离沙箱中运行，校验入参后调用本地调度器并格式化呈现耗时、状态码与回包。
* **防漂移最高指示**：严格遵守 LF 换行契约，严禁引入施工批次与敏捷工期临时标记，保持 ELOC 与圈复杂度低认知名义。

---

## 一、 核心功能增强规格

### 1.1 `kalar-mod dispatch` 命令行界面

```bash
# 直接发送 ESC 保存游戏请求
python WebGames/mod_sdk/tools/kalar_mod.py dispatch --domain world_state --action ESC_SAVE_GAME --payload '{"slot_id": "SLOT_01"}'

# 模拟 Agent 发送加点请求
python WebGames/mod_sdk/tools/kalar_mod.py dispatch --actor AGENT --domain world_state --action ALLOCATE_POTENTIAL_STAT --payload '{"stat_key": "strength", "points": 1}' --json
```

### 1.2 `play_mod.py` 贯通主页 HUD 推演

```bash
# 序章推演完成后，自动输出主页 HUD 初始切片
python WebGames/mod_sdk/tools/kalar_mod.py play ./my_mod --with-hud --json
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 3.1: 在 `kalar_mod.py` 中新增 `dispatch` 子命令解析与执行逻辑
- [x] Step 3.2: 扩展 `play_mod.py` 增加 `--with-hud` 全链路主页 HUD 初始状态切片输出
- [x] Step 3.3: 升级 `scaffold_mod.py` 与 `MOD_SPEC.md`，同步新增协议交互规范说明

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-MSDK-S3-01 | CLI dispatch 子命令功能断言 | 执行 kalar_mod dispatch --domain world_state --action ESC_QUERY_READINESS | 成功派发并输出格式化 UnifiedResponseEnvelope，退出码 0 |
| TC-MSDK-S3-02 | play_mod --with-hud 贯通推演 | 运行 play_mod ./templates/starter_story --with-hud --json | 战报尾部包含 home_hud_slice 节点，包含六维属性与初始资产 |
| TC-MSDK-S3-03 | CLI 门面子命令完整性 | 检查 kalar_mod.py 支持的命令列表 | 包含 7 大核心子命令，无遗漏项 |
| TC-MSDK-S3-04 | 创作者速查指南同步 | 检查 MOD_SPEC.md 文本 | 完整收录 dispatch 命令与统一协议信封速查指南 |

