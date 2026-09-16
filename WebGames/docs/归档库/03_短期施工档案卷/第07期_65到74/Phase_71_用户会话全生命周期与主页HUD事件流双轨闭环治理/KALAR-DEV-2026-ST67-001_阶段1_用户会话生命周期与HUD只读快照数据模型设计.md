---
档号: KALAR-DEV-2026-ST67-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST67 (Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段1：用户会话生命周期与HUD只读快照数据模型设计
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: CharacterPhysiologySheet; CharacterWalletEntity; 标准账号注册数据契约; 主页 HUD 权威状态快照契约; 细粒度增量数值突变事件模型
---

# 施工细则：Phase 71 用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段1：用户会话生命周期与HUD只读快照数据模型设计

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：针对 2026-09-08 用户全链路调查（注册登录 ➔ 选角输入昵称 ➔ 序章剧情 ➔ 主页 HUD ➔ 存档停机退出）定位的后端缺口，在纯无头层补全数据模型底座，**并严格以既有领域实体/配置真源为唯一事实来源，严禁臆造字段**：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md)。
> 1. 确立**双轨解耦通信模型**：以 `EventBus.emit_domain_event` 领域事件广播为主轨（状态突变异步推流），辅以**只读无头快照门面查询 DTO**（前端就绪时首帧按需拉取），严禁修改任何前端代码；
> 2. 补全标准账号注册输入/输出模型（`AccountRegistrationDTO.Request/Response`）；
> 3. 规范顶层主页 HUD 权威只读状态快照模型（`HudStatusSnapshotDTO`，**字段全部可溯源到真实实体/配置**）及细粒度增量突变事件模型（`HudMutationEventsDTO`）；
> 4. 频道常量一律**配置化**（`account.*` / `world_state.*`，遵循 `EventBus` `<domain_id>.<event_name>` 硬约定），严格保证除数下限守卫与会话口令脱敏不变量；
> 5. 与已授权长期演进区「演进 02」（HUD 前端接线）**契约定基准、分工不重复**。
> **对应需求源**：用户全链路闭环调查指令（2026-09-08）；`AUDIT_REPORT_前端可视化.md` 零后端接线痛点；`docs/路线图/02_长期演进区/演进_02_EventBus前端HUD事件接线与状态同步架构/`（S1 契约权威）；Phase 70 配置库唯一事实收敛治理（事实归属与文案通道契约）。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST67-002_阶段2_会话鉴权事件总线与HUD双轨同步核心算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST67-003_阶段3_配置驱动扩展与全域EventBus无头接线工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST67-004_阶段4_会话流转与HUD双轨事件同步全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**（现状规范基座与真实 API 证据，2026-09-08 实测）：
  - `backend/infrastructure/event_bus.gd:37`：信号 `domain_event(channel, payload)`；`:145-165` `render_domain_event_text` 按 `<domain_id>.<event_name>` 解析叙事模板（`payload["args"] % 模板` 渲染）；`:169-177` `emit_domain_event` 官方唯一入口（叙事需 payload 携带 `args` 与 `category_key`）；
  - `backend/domains/lifecycle_physiology/physiology_entities.gd`：`class_name CharacterPhysiologySheet`，真实实值入口 `get_actual_value(attr)` / `get_actual_values()` / `get_all_levels()`——**无 hp/mp/ap 字段，禁止直接访问**；
  - `backend/domains/currency_economy/currency_entities.gd`：`class_name CharacterWalletEntity`，真实字段 `copper/silver/gold/platinum/mana_monocrystals`（**无 mana_crystals**）；
  - `backend/domains/account/auth_service.gd`：`hash_password` / `authenticate_local` / `create_guest_account` / `token_prefix` 既有；当前**无 `register_account`**（本卷新增）；
  - `backend/domains/account/account_profile.gd`：`class_name AccountProfileAggregate`，字段 `username/password_hash_sha256/created_timestamp_utc/last_login_timestamp_utc/local_device_fingerprint/is_guest_mode/entitlements`；
  - `backend/infrastructure/id_generator.gd:27`：`UniqueIdGenerator.next_id(prefix)`；
  - `backend/domains/world_gateway/world_gateway_fsm.gd:90-107`：`enter_world()` → `IN_WORLD` → 既有 `world_gateway.world_entered` 广播（复用，不重造）；
  - `config/domains/combat.json participant_defaults`：真实键仅 `name/hp/max_hp/ap/...`——**无 mp/max_mp/ap_max**；`config/domains/account.json auth`：已有 `errors`（ok/account_not_found/invalid_credentials/device_mismatch）与 `token_prefix/session`；
  - `config/infrastructure/domains.json`：`world_state` 域当前 config/narrative 均别名到 `telemetry_account_lifecycle` 表（本卷需改指自有表）；
  - `docs/路线图/02_长期演进区/演进_02_...`：S1 已授权定义 `HudStatusSnapshotDTO`（除数下限守卫）与 `HudEventContract` 订阅白名单——**契约权威**。
* **核心不变量约束断言**：
  - `Inv-HDS-1 (权威单一源头)`：`HudStatusSnapshotDTO` 各字段必须逐一溯源到真实领域实体（生理实值/钱包/位置）或配置表（combat participant_defaults / world_state hud_defaults），**禁止硬编码、禁止 Mock 常量充当权威值**；
  - `Inv-HDS-2 (双轨强一致性)`：无头查询门面返回的快照与 EventBus 广播的最新快照在同一逻辑时钟周期内数据完全等价；
  - `Inv-HDS-3 (零除防御钳制)`：`hp_max`/`ap_max` 字段强保证 `>= 1.0`，从根源杜绝前端血条渲染零除异常；
  - `Inv-HDS-4 (会话敏感信息脱敏)`：`account.*` 广播事件载荷严禁泄露明文口令或加盐哈希，仅暴露 `account_id`、`username`、`token_prefix` 与时间戳；
  - `Inv-HDS-5 (前端绝对零入侵)`：本案卷所有交付物与修改点 100% 局限于 `backend/` 纯无头模块与 `config/` 配置表，严禁改动任何 `frontend/` 目录代码。
* **防漂移最高指示**：
  - 严禁臆造领域实体不存在的字段（如 physiology 的 hp/mp/ap、wallet 的 mana_crystals、无源可依的等级/经验/MP 上限）——无权威来源的展示项一律不入快照，留待对应域闭环（演进02/等级域/法力域）扩展；
  - 频道名必须遵循 `<domain_id>.<event_name>` 硬约定并配置化，严禁散落魔法字符串；
  - 与「演进 02」同名的 `HudStatusSnapshotDTO`/`HudEventContract` 以演进02 S1 为契约权威，本卷只实现后端数据流，严禁重复定义前端契约。

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. 标准账号注册数据契约 (Account Registration DTO)
* 模块路径: `res://backend/domains/account/dto/account_registration_dto.gd`
* 职责: 规范非游客正常注册的输入与输出数据载荷，屏蔽底层哈希细节。

```gdscript
class_name AccountRegistrationDTO
extends RefCounted

## 注册请求载荷（password_plain 仅存在于本 DTO 内存态，禁止入广播/日志）
class Request extends RefCounted:
	var username: String = ""
	var password_plain: String = ""
	var device_fingerprint: String = ""
	var initial_entitlements: Array[String] = []

	func to_dto() -> Dictionary:
		return {
			"username": username,
			"device_fingerprint": device_fingerprint,
			"initial_entitlements": initial_entitlements.duplicate()
		}

## 注册响应载荷
class Response extends RefCounted:
	var success: bool = false
	var error_code: String = "OK"
	var account_id: String = ""
	var username: String = ""
	var created_timestamp_utc: int = 0
```

### 2. 主页 HUD 权威状态快照契约 (HudStatusSnapshotDTO)
* 模块路径: `res://backend/domains/world_state/dto/hud_status_snapshot_dto.gd`
* 契约权威: 演进02 S1（本卷为实现后端数据流，字段与除数下限守卫一致）。
* 职责: 聚合**真实可溯源**的角色身份、六维实值、生理层级、展示型生命/行动力与资产钱包，作为双轨标准快照载荷。

```gdscript
class_name HudStatusSnapshotDTO
extends RefCounted

var account_id: String = ""
var character_id: String = ""
var character_name: String = ""
var race_id: String = "HUMAN"
var current_location_id: String = ""

# 六维 L3 实值（真源：CharacterPhysiologySheet.get_actual_values()）与层级（get_all_levels()）
var attribute_values: Dictionary = {}   # attr -> float
var attribute_levels: Dictionary = {}   # attr -> int 1..6

# 展示型生命/行动力（真源上限：domains.combat participant_defaults / world_state hud_defaults；当前值初始=上限，由增量事件驱动）
var hp_current: float = 0.0
var hp_max: float = 100.0
var ap_current: float = 0.0
var ap_max: float = 10.0

# 资产钱包（真源：CharacterWalletEntity 真实字段）
var wallet_gold: int = 0
var wallet_mana_monocrystals: int = 0

# 时钟与时间戳
var timestamp_utc: int = 0

func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"current_location_id": current_location_id,
		"attribute_values": attribute_values.duplicate(),
		"attribute_levels": attribute_levels.duplicate(),
		"hp_current": hp_current,
		"hp_max": hp_max,
		"ap_current": ap_current,
		"ap_max": ap_max,
		"wallet_gold": wallet_gold,
		"wallet_mana_monocrystals": wallet_mana_monocrystals,
		"timestamp_utc": timestamp_utc
	}

static func from_dto(data: Dictionary) -> HudStatusSnapshotDTO:
	var dto := HudStatusSnapshotDTO.new()
	dto.account_id = String(data.get("account_id", ""))
	dto.character_id = String(data.get("character_id", ""))
	dto.character_name = String(data.get("character_name", ""))
	dto.race_id = String(data.get("race_id", "HUMAN"))
	dto.current_location_id = String(data.get("current_location_id", ""))
	dto.attribute_values = (data.get("attribute_values", {}) as Dictionary).duplicate()
	dto.attribute_levels = (data.get("attribute_levels", {}) as Dictionary).duplicate()
	dto.hp_current = maxf(0.0, float(data.get("hp_current", 0.0)))
	dto.hp_max = maxf(1.0, float(data.get("hp_max", 100.0)))
	dto.ap_current = maxf(0.0, float(data.get("ap_current", 0.0)))
	dto.ap_max = maxf(1.0, float(data.get("ap_max", 10.0)))
	dto.wallet_gold = int(data.get("wallet_gold", 0))
	dto.wallet_mana_monocrystals = int(data.get("wallet_mana_monocrystals", 0))
	dto.timestamp_utc = int(data.get("timestamp_utc", 0))
	return dto
```

> **【事实溯源与防臆造说明】**：`attribute_values`/`attribute_levels` 由 `CharacterPhysiologySheet` 真实 API 派生；`hp_max`/`ap_max` 上限分别以 `domains.combat participant_defaults.hp` 与 `domains.world_state hud_defaults.ap_max` 为配置真源；**MP、等级经验、ap/mp 上限不存在权威源，本卷不纳入**，列入后续域闭环扩展清单（演进02 前端契约 / 等级域 / 法力域）。

### 3. 细粒度增量数值突变事件模型 (Mutation Event DTOs)
* 模块路径: `res://backend/domains/world_state/dto/hud_mutation_events_dto.gd`
* 职责: 单项属性/钱包变动时避免高频广播完整大快照，提供精准增量事件流。

```gdscript
class_name HudMutationEventsDTO
extends RefCounted

## 角色单项属性增量突变（stat_name 取值域 = physiology attribute 键）
class StatMutation extends RefCounted:
	var character_id: String = ""
	var stat_name: String = ""
	var old_value: float = 0.0
	var new_value: float = 0.0
	var delta: float = 0.0
	var cause_event: String = ""
	var timestamp_utc: int = 0

## 钱包货币增量突变（currency_type 取值域 = CharacterWalletEntity.CURRENCY_FIELDS）
class WalletMutation extends RefCounted:
	var account_id: String = ""
	var currency_type: String = "gold"
	var old_amount: int = 0
	var new_amount: int = 0
	var delta: int = 0
	var reason_key: String = ""
	var timestamp_utc: int = 0
```

### 4. EventBus 频道常量契约（配置驱动，`HudEventContract`）
* 模块路径: `res://backend/domains/world_state/hud_event_contract.gd`
* 契约权威: 演进02 S1 `HudEventContract`（本卷仅实现后端侧频道常量**配置化解析**，值统一经 `GameConfig` 读取，消除魔法字符串）。
* 频道命名遵循 `event_bus.gd` 硬约定 `<domain_id>.<event_name>`：`account.*` 与 `world_state.*`（**不得使用 auth/hud 等非域 id 前缀**，否则叙事模板解析落空）。

```gdscript
class_name HudEventContract
extends RefCounted

static func channel_auth_registered() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/registered", "account.registered")
static func channel_auth_login_succeeded() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/login_succeeded", "account.login_succeeded")
static func channel_auth_session_revoked() -> String:
	return GameConfig.get_string("domains.account", "auth/channels/session_revoked", "account.session_revoked")
static func channel_hud_snapshot() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/snapshot", "world_state.snapshot_published")
static func channel_hud_stat_mutated() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/stat_mutated", "world_state.stat_mutated")
static func channel_hud_wallet_mutated() -> String:
	return GameConfig.get_string("domains.world_state", "hud/channels/wallet_mutated", "world_state.wallet_mutated")
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 1.1: 真实 API 现场复核** - 以本卷「溯源指针」为准，二次确认 `CharacterPhysiologySheet`/`CharacterWalletEntity`/`AuthService`/`EventBus` 的真实方法名、字段名与 `domains.combat participant_defaults` 键集，任何偏差按真实实体修正，**禁止沿用本卷示例字段名臆造**。
- [ ] **Step 1.2: 注册 DTO 与快照 DTO 落地** - `account_registration_dto.gd`、`hud_status_snapshot_dto.gd`（字段全部可溯源 + 除数下限守卫 + 深度序列化对称）。
- [ ] **Step 1.3: 增量突变 DTO 与频道契约落地** - `hud_mutation_events_dto.gd`（stat_name/currency_type 取值域对齐真实实体）；`hud_event_contract.gd` 配置化频道解析。
- [ ] **Step 1.4: 防臆造白名单与扩展清单登记** - 将「MP/等级经验」等无权威源展示项登记为后续扩展清单（写入阶段3 的 world_state 配置 `_meta.extensions_note`），本卷快照零纳入。

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S1-01` | 快照 DTO 字段全部可溯源 | 逐字段溯源核查表 | 每个字段命中真实实体字段/配置键，0 臆造（含无 mp/level/exp） |
| `TC-HDS-S1-02` | 序列化与反序列化对等 + 除数守卫 | `hp_max=0/-1`、`ap_max=0` 字典 | `from_dto(to_dto())` 深度等价；`hp_max/ap_max` 钳制 `>=1.0` |
| `TC-HDS-S1-03` | 注册 DTO 请求脱敏 | `Request.to_dto()` | 载荷不含 `password_plain`，仅身份字段 |
| `TC-HDS-S1-04` | 频道命名符合硬约定且配置化 | 契约解析 + 配置表 | 全部频道形如 `<domain_id>.<event_name>`，值来自配置且默认值一致 |
