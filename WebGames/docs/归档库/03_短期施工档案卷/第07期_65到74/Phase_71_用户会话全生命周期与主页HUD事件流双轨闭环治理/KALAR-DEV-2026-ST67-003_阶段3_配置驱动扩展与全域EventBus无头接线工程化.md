---
档号: KALAR-DEV-2026-ST67-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST67 (Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段3：配置驱动扩展与全域EventBus无头接线工程化
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: HDS3; 注册规则与错误码扩展; world_state 域改指自有表; color; account.json
---

# 施工细则：Phase 71 用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段3：配置驱动扩展与全域EventBus无头接线工程化

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：完成 Phase 71 新增服务、频道与规则的工程化配置驱动落地与全域无头接线，**对齐 Phase 70 配置库唯一事实收敛契约**：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md)。
> 1. `config/domains/account.json` 补齐注册规则与错误码（`auth/rules` + `auth/errors` 扩展），参数 100% 配置驱动；
> 2. 新增 `config/domains/world_state.json`（HUD 频道白名单 + `hud_defaults` + 防臆造扩展清单注解），并在 `domains.json` 中将 world_state 域 config/narrative 从 telemetry 别名**改指自有表**（现场复核后）；
> 3. `config/infrastructure/event_categories.json` 登记 `auth`/`hud` 事件分类（对齐既有 name+color 结构）；
> 4. 叙事模板补齐（`narratives/account.json` + 新建 `narratives/world_state.json`），模板遵循 `emit_domain_event` 的 `%s`+`args` 官方渲染契约；
> 5. 完成后端与世界网关进世界、钱包变动的无头事件接线，零前端入侵。
> **对应需求源**：Phase 71 阶段 1、阶段 2；`config/domains/account.json`；`config/infrastructure/domains.json`；Phase 70 阶段 1~3（事实归属矩阵 / 文案通道收敛 / 防过度归一红线）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST67-001_阶段1_用户会话生命周期与HUD只读快照数据模型设计.md) ｜ [阶段2](KALAR-DEV-2026-ST67-002_阶段2_会话鉴权事件总线与HUD双轨同步核心算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST67-004_阶段4_会话流转与HUD双轨事件同步全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**（现状真源，2026-09-08 实测）：
  - `config/domains/account.json`：顶层键 `auth / save_slot / entitlements / cdkeys`；`auth` 已有 `session/salt/default_username/guest_*/token_*/errors`（errors 含 ok/account_not_found/invalid_credentials/device_mismatch）——本卷在 `auth` 下**新增** `rules` 与扩展 `errors`，不改动既有键；
  - `config/infrastructure/domains.json`：`world_state` 域当前 `config: domains.telemetry_account_lifecycle`、`narrative: narratives.telemetry_account_lifecycle`（别名）；`telemetry_account_lifecycle` 域独立存在——改指前须现场复核别名消费方（TC-ARCH-01/05 双向一致 + audit_config_unused 无死引用）；
  - `config/infrastructure/event_categories.json`：条目结构 `{ "name": "XXX", "color": "#hex" }`（`_default` 另含 `error_color`），**无 description 字段**；
  - `config/narratives/account.json`：既有 `cdkey_*` 三键（本卷追加 `registered/login_succeeded/session_revoked`，不覆盖既有键）；
  - `backend/infrastructure/event_bus.gd:145-165`：叙事模板取键 = 频道 `<domain_id>.<event_name>` 的 event_name，`payload["args"] % 模板` 渲染；
  - Phase 70 文案通道定界（阶段1 D8 决策树）：事件回执短文案承载于 `narratives.<域>` 经 EventBus `%s`+args 官方机制；`CopywritingResolver` 仅用于条件化长描述——本卷新增文案严格落在 `narratives.*` 通道，**禁止在域数值表直书文案**（对齐 `Inv-SS-2`）。
* **核心不变量约束断言**：
  - `Inv-HDS3-1 (配置驱动零硬编码)`：注册规则阈值、错误码、频道名、快照上限 100% 经 `GameConfig` 检索，代码严禁硬编码字面量（对齐 ADV-CFG-001）；
  - `Inv-HDS3-2 (架构双向一致性与别名改指复核)`：新增 `domains.world_state` 表与 `narratives.world_state` 表登记后，`domains.json` 的 config/narrative 字段同步改指，`test_architecture_guard.gd` 门禁与 audit_config_unused 死引用全绿；
  - `Inv-HDS3-3 (平滑降级与零前端容错)`：当无任何前端订阅 `world_state.*`/`account.*` 频道时，后端事件发布以纯内存广播正常返回，零异常抛出；
  - `Inv-HDS3-4 (文案模板-载荷契约一致)`：每条叙事模板的 `%s/%d` 占位符与对应广播 payload 的 `args` 顺序、个数完全一致（阶段 2 契约完备性自检在配置层复验）。
* **防漂移最高指示**：改指 `domains.json` 前必须先跑 `scripts/py/audit_config_unused.py` 与 `test_architecture_guard.gd` 留档基线；`event_categories` 新条目必须严格对齐既有 name+color 结构，禁止引入 description 等非标键。

---

## 一、 配置驱动扩展 (Configuration Extensions)

### 1. account.json 注册规则与错误码扩展（`auth` 节点内追加，不改既有键）
```json
{
  "auth": {
    "account_id_prefix": "ACC_USR_",
    "rules": {
      "min_username_length": 3,
      "max_username_length": 24
    },
    "errors": {
      "ok": "OK",
      "account_not_found": "ERR_ACCOUNT_NOT_FOUND",
      "invalid_credentials": "ERR_INVALID_CREDENTIALS",
      "device_mismatch": "ERR_DEVICE_MISMATCH",
      "account_already_exists": "ERR_ACCOUNT_ALREADY_EXISTS",
      "invalid_username_length": "ERR_INVALID_USERNAME_LENGTH"
    },
    "channels": {
      "registered": "account.registered",
      "login_succeeded": "account.login_succeeded",
      "session_revoked": "account.session_revoked"
    }
  }
}
```

### 2. 新增 domains/world_state.json（HUD 频道白名单 + 上限默认 + 防臆造扩展清单）
```json
{
  "_meta": {
    "domain": "world_state",
    "extensions_note": "MP、等级经验、ap_max 实值等无权威源的展示项，本卷不入快照，留待演进02 前端契约 / 等级域 / 法力域闭环扩展"
  },
  "hud": {
    "channels": {
      "snapshot": "world_state.snapshot_published",
      "stat_mutated": "world_state.stat_mutated",
      "wallet_mutated": "world_state.wallet_mutated"
    }
  },
  "hud_defaults": {
    "ap_max": 10.0,
    "snapshot_of": {
      "hp_max": "domains.combat/participant_defaults/hp"
    }
  }
}
```

### 3. domains.json world_state 域改指自有表（R2 复核后落地）
```json
{
  "id": "world_state",
  "config": "domains.world_state",
  "narrative": "narratives.world_state",
  "test": "res://tests/unit/test_telemetry_account_lifecycle.gd",
  "test_symbol": "TestTelemetryAccountLifecycleDomain",
  "phase": 4,
  "depends_on": ["world_navigation"]
}
```
（`telemetry_account_lifecycle` 域条目保持不动；改指仅限 `config`/`narrative` 两字段，`test` 归属若需更新亦同步复核。）

### 4. event_categories.json 事件分类补全（对齐既有 name+color 结构）
```json
{
  "auth":  { "name": "AUTH", "color": "#4A90E2" },
  "hud":   { "name": "HUD",  "color": "#50E3C2" }
}
```

### 5. 叙事模板补齐（`%s`/`%d` + payload args 契约，Inv-HDS3-4）
```json
// config/narratives/account.json（追加三键，保留既有 cdkey_*）
{
  "registered": "【鉴权】开拓者 %s 成功在卡拉尔世界建立身份档案。",
  "login_succeeded": "【鉴权】欢迎归来，开拓者 %s！",
  "session_revoked": "【鉴权】开拓者 %s 的会话已安全注销。"
}
// config/narratives/world_state.json（新建）
{
  "stat_mutated": "【状态】角色属性 %s 发生变动（%+f → %+f）。",
  "wallet_mutated": "【财务】%s 变动 %+d。"
}
```

---

## 二、 全域无头接线工程化 (Headless Wiring)

### 1. 世界网关进入世界联动点（复用既有事件，不新增）
* 模块路径: `res://backend/domains/world_gateway/world_gateway_fsm.gd`
* `enter_world()` 成功跃迁 `IN_WORLD` 后既有 `world_entered` 广播（`:96`）已存在；本卷仅在其消费侧（集成宿主/测试桩）调用 `HudStateSyncService.trigger_initial_world_sync()` 派发首帧快照，**不修改网关事件定义**。

### 2. 经济系统货币变更联动点
* 模块路径: `res://backend/domains/currency_economy/currency_sinks_fsm.gd`
* 在货币事务成功且已触发既有叙事后，同步调用 `HudStateSyncService.publish_wallet_mutation(account_id, currency_type, old_amt, new_amt, reason)`（`currency_type` 取值于 `CURRENCY_FIELDS`）。

### 3. 前端零侵入性保障机制
* 本案卷**绝对不修改** `frontend/views/main_hud/main_hud_view.gd` 及任何 `.tscn` 场景文件；
* 前端预留：演进02 接线时仅需调用 `HudStateSyncService.get_hud_status_snapshot()` 首帧拉取并订阅 `HudEventContract` 频道处理增量；本阶段由后端提供完整测试桩与无头断言前置锁定全部数据流。

### 4. 与 Phase 70 / 演进02 的协同边界（顺序与文件冲突防并发）
* **执行顺序**：Phase 70（配置库唯一事实收敛）→ Phase 71（本卷）→ 演进02（前端接线契约最终化）；
* **同文件冲突**：本卷新增 `auth/rules` 与 `narratives/account.json` 追加键，须在 Phase 70 完成 `account.json` cdkeys 收敛与文案通道治理之后落地，避免同文件并发编辑；`event_categories` 仅追加 `auth/hud` 两条，不与 P70 冲突；
* **契约基准**：`HudStatusSnapshotDTO`/`HudEventContract` 以演进02 S1 为权威，本卷只实现后端数据流，杜绝同名双定义漂移。

---

## 三、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 3.1: 配置扩展落地** - account.json（auth/rules/errors/channels）、新建 domains/world_state.json、event_categories 追加、narratives 模板补齐（含新建 narratives/world_state.json）。
- [ ] **Step 3.2: domains.json 改指与基线复核** - 先跑 `audit_config_unused.py` + `test_architecture_guard.gd` 留档基线；再改 world_state config/narrative 指自有表；改后复跑双向差集 0、死引用 0。
- [ ] **Step 3.3: 无头接线落地** - world_entered 首帧联动、currency_sinks 钱包突变联动（复用既有事件与叙事，不新增通道）。
- [ ] **Step 3.4: 契约与白名单自检** - 叙事模板-args 契约逐一比对；频道命名 `<domain_id>.<event_name>` 校验；Phase 70 文案通道红线复核（无域表直书新增）。

---

## 四、 工程化验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S3-01` | 配置驱动零硬编码 | 全域静态扫描 | 本卷代码无频道/错误码/阈值字面量（对齐 ADV-CFG-001） |
| `TC-HDS-S3-02` | 架构双向一致与改指安全 | 改指前后 audit_config_unused + arch guard | 双向差集 0、死引用 0；domains.json 字段与实表一致 |
| `TC-HDS-S3-03` | 叙事模板-载荷契约一致 | 模板与广播 payload 逐键比对 | 每条模板占位符与 args 顺序/个数 100% 匹配 |
| `TC-HDS-S3-04` | 无订阅平滑降级 | 无前端订阅下发布事件 | 纯内存广播正常返回，零异常；`world_entered` 首帧派发一次成功 |
| `TC-HDS-S3-05` | 前端零入侵 + P70 协同 | git diff 扫描 frontend/ | frontend/ 改动数 0；与 P70 同文件冲突为 0（先 P70 后 P71） |
