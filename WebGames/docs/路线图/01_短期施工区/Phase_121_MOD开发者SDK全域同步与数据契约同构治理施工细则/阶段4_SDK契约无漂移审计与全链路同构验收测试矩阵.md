---
档号: KALAR-DEV-2026-ST117-004
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-RM (技术研发·施工路线图)
年度: 2026年
案卷号: ST117 (MOD开发者SDK全域同步与数据契约同构治理施工细则)
件号: 004
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase 121 MOD开发者SDK全域同步与数据契约同构治理 —— 阶段4：SDK契约无漂移审计与全链路同构验收测试矩阵
形成日期: 2026-10-13
归档日期: 2026-10-13
验收状态: 规划就绪 (PLANNING)
主题词/关键词: 门禁矩阵; 契约无漂移; 验收测试; TC-SDK-SYNC; 阶段4
---

# 施工细则：Phase 121 MOD开发者SDK全域同步与数据契约同构治理 —— 阶段4：SDK契约无漂移审计与全链路同构验收测试矩阵

> [!NOTE]
> **【施工目标】**：针对 Phase 121 完成的 MOD 开发者 SDK 全域能力清单萃取、强类型 JSON Schema 字典扩充、官方规范文档刷新与门禁守卫集成，构建完整的静态审计与无头验收测试矩阵（TC-SDK-01 ~ TC-SDK-08）。确保 SDK 契约在全生命周期内与引擎运行时达成 100% 绝对一致，杜绝任何数据漂移（`RCFG-RULE-DRIFT`），实现零缺陷交割与路线图闭环。
> 施工开始日期: 2026-10-13

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：[AGENTS.md 工作区全局刚性公理](../../../../../AGENTS.md) §一、§二.1、§四；[阶段1_MOD开发者SDK权威真源萃取与遥测契约规范设计.md](阶段1_MOD开发者SDK权威真源萃取与遥测契约规范设计.md)；[阶段2_静态萃取引擎升级与HUD遥测和专属动作Schema实现.md](阶段2_静态萃取引擎升级与HUD遥测和专属动作Schema实现.md)；[阶段3_交互推演协议与伴侣广播规范文档及门禁集成.md](阶段3_交互推演协议与伴侣广播规范文档及门禁集成.md)；[audit_sdk_sync.py](../../../../scripts/py/audit_sdk_sync.py)；[sync_mod_sdk.py](../../../../scripts/py/sync_mod_sdk.py)
* **核心不变量约束断言**：
  - `Inv-DRIFT-FREE-ORACLE-1 (双向无漂移神谕断言)`：在任意代码提交前后，`python WebGames/scripts/py/sync_mod_sdk.py --check-only` 必须稳定返回 0，证明生成文件与配置真源 100% 字节等价；
  - `Inv-FULL-PASS-AUDIT-2 (门禁审计全项全绿公理)`：`python WebGames/scripts/py/audit_sdk_sync.py` 执行 8 大项审计必须全量通过，Findings 数量恒等于 0；
  - `Inv-ZERO-REGRESSION-3 (全仓五大支柱零回归断言)`：`audit-all.ps1 -Fast` 评分必须保持 A+（>= 99.0），全仓零规则漂移且无新增债务。
* **防漂移最高指示**：严格使用客观技术事实断言，禁止出现程序化流水账或虚假测试计数。

---

## 一、 验收测试用例矩阵 (TC-SDK-01 ~ TC-SDK-08)

| 用例编号 | 验证目标与测试范围 | 输入与断言前置条件 | 质性断言与预期判定标准 | 状态 |
| :---: | :--- | :--- | :--- | :---: |
| **TC-SDK-01** | `sync_mod_sdk.py` 能力萃取输出完整性 | 静态解析 `world_state/core.json` | `capabilities.json` 包含 `agent_hud_telemetry_capabilities`，且包含 7 大指令与租约配置 | 待执行 |
| **TC-SDK-02** | `sync_mod_sdk.py --check-only` 零漂移 | 传入已落盘的 SDK 资产 | 退出码为 0，无任何 diff 漂移抛出 | 待执行 |
| **TC-SDK-03** | `MOD_SPEC.md` 动态生成区段受控更新 | 检查 `<!-- AUTOGEN_CAPABILITIES_* -->` | 动态标记区成功渲染 HUD 遥测与行动空间表格，手工维护区段 100% 保持未被侵入 | 待执行 |
| **TC-SDK-04** | `agent_hud_telemetry_packet.schema.json` 语法与契约 | 校验 JSON Schema 规范性 | 根节点为对象，完整覆盖 `envelope`, `control_lease`, `observation`, `causal_deltas`, `action_space` | 待执行 |
| **TC-SDK-05** | `agent_action_packet.schema.json` 语法与契约 | 校验 JSON Schema 规范性 | 根节点为对象，`directive_id` 严格约束为 7 大指令枚举，`params` 为对象 | 待执行 |
| **TC-SDK-06** | `AGENT_INTERACTION.md` 规范文档完整性 | 静态检查文档正文 | 包含主页 HUD 时序图、7 大指令参数表、人类抢占只读退化及二进制编解码说明 | 待执行 |
| **TC-SDK-07** | `COMPANION_PROTOCOL.md` 广播主题穷尽性 | 静态检查文档正文 | 包含 `agent_hud_packet_streamed` 主题定义，并对齐 O(1) 定长环形缓冲说明 | 待执行 |
| **TC-SDK-08** | `audit_sdk_sync.py` 全项门禁合规验证 | 运行全项静态审计 | 覆盖 12 项 Schema 与全量 docs/tools，Findings 数量为 0，退出码为 0 | 待执行 |

---

## 二、 验证执行命令流

1. **静态萃取与防漂移验证**：
   ```bash
   python WebGames/scripts/py/sync_mod_sdk.py
   python WebGames/scripts/py/sync_mod_sdk.py --check-only
   ```
2. **SDK 全项资产完整性与门禁审计**：
   ```bash
   python WebGames/scripts/py/audit_sdk_sync.py
   ```
3. **全工作区快速门禁预审**：
   ```powershell
   pwsh -File scripts/ps1/audit-all.ps1 -Fast
   ```

---

## 三、 阶段交付清单与验收标准

1. 完成 TC-SDK-01 ~ TC-SDK-08 全项用例测试证明；
2. 确保 `audit_sdk_sync.py` 与 `sync_mod_sdk.py --check-only` 100% 绿色通过；
3. 更新 `WebGames/docs/路线图/路线图总索引.md`，将 Phase 121 状态标记为已验收；
4. 全工作区门禁保持 A+ 评级，完成技术档案正式归位。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] Step 4.1: 执行 sync_mod_sdk.py --check-only 验证契约一致
- [x] Step 4.2: 执行 audit_sdk_sync.py 确保 Schema 全量合规
- [x] Step 4.3: 更新 路线图总索引.md 并闭环回归

---

## 三、 DoD 验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| TC-MSDK-S4-01 | MOD SDK 零漂移静态门禁 | 执行 python sync_mod_sdk.py --check-only | 返回状态码 0，真源与 Schema 无任何未提交漂移 |
| TC-MSDK-S4-02 | 门禁全景扫描无新增告警 | 运行 python audit_sdk_sync.py | 全部 12 项 Schema 校验通过，零 warning，零 error |
| TC-MSDK-S4-03 | 路线图索引状态原子同步 | 检查 路线图总索引.md | 状态准确更新，条目计数与物理方案案卷严格自洽 |
| TC-MSDK-S4-04 | 全仓门禁绿灯与同构一致 | 运行工作区预审命令 | 各支柱均处于 100% PASS 状态，无破坏基线行为 |

