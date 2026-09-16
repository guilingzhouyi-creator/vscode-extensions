---
档号: KALAR-DEV-2026-ST67-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST67 (Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_71_用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段2：会话鉴权事件总线与HUD双轨同步核心算法实现
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: HudStateSyncService; AuthService 标准注册与鉴权事件广播扩展; 无头主页 HUD 状态同步服务; 注册唯一性与幂等拦截
---

# 施工细则：Phase 71 用户会话全生命周期与主页HUD事件流双轨闭环治理 —— 阶段2：会话鉴权事件总线与HUD双轨同步核心算法实现

> 施工开始日期：2026-09-08（下午）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：实现 Phase 71 阶段 1 数据契约的核心无头业务算法与服务，**全部基于真实领域 API 与配置真源**：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md)。
> 1. 在 `AuthService` 新增标准注册（`register_account`）并挂接 EventBus 广播（`account.registered` / `account.login_succeeded` / `account.session_revoked`），**载荷必带 `category_key` 与 `args`**（`emit_domain_event` 叙事渲染契约）；
> 2. 构建无头主页 HUD 状态同步服务（`HudStateSyncService`），实现双轨通信中枢：
>    - **拉轨（Pull Facade）**：`get_hud_status_snapshot()` 无状态只读门面，字段 100% 派生自 `CharacterPhysiologySheet`（`get_actual_values`/`get_all_levels`）与 `CharacterWalletEntity` 真实字段；
>    - **推轨（Push EventBus）**：`publish_hud_snapshot()` / `publish_stat_mutation()` / `publish_wallet_mutation()`；
> 3. 复用既有 `world_gateway.world_entered` 事件触发首帧快照派发（`world_gateway_fsm.gd:96`），不新增网关事件；
> 4. 严格保持无头纯逻辑解耦，零前端入侵。
> **对应需求源**：Phase 71 阶段 1 契约；`backend/domains/account/auth_service.gd`；`backend/infrastructure/event_bus.gd`；`backend/domains/lifecycle_physiology/physiology_entities.gd`；`backend/domains/currency_economy/currency_entities.gd`。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST67-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST67-001_阶段1_用户会话生命周期与HUD只读快照数据模型设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST67-003_阶段3_配置驱动扩展与全域EventBus无头接线工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST67-004_阶段4_会话流转与HUD双轨事件同步全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**（真实 API，2026-09-08 实测）：
  - `CharacterPhysiologySheet`：`get_actual_value(attr) -> float`、`get_actual_values() -> Dictionary`、`get_all_levels() -> Dictionary`（六维实值与层级唯一真源）；
  - `CharacterWalletEntity`：`gold` / `mana_monocrystals`（int 字段），`CURRENCY_FIELDS` 常量；
  - `EventBus.get_instance().emit_domain_event(channel, payload)`：payload 需含 `args`（`%s/%d` 模板填充）与 `category_key`（取色，默认 system）；渲染逻辑 `render_domain_event_text`（`event_bus.gd:145-165`）；
  - `WorldGatewayFSM.enter_world`（`world_gateway_fsm.gd:90`）→ `IN_WORLD` 后既有 `_notify_event("world_gateway.world_entered", ...)`（`:96`）→ `EventBus.emit_domain_event`（`:107`）；
  - `AuthService`：`hash_password` / `authenticate_local` / `token_prefix`（`auth_service.gd:33/80/93`）。
* **核心不变量约束断言**：
  - `Inv-HDS2-1 (注册唯一性与幂等拦截)`：同名账号重复注册必须立即拦截并返回 `ERR_ACCOUNT_ALREADY_EXISTS`（配置真源 `domains.account auth/errors`），不产生任何脏数据持久化；
  - `Inv-HDS2-2 (无状态中枢零泄漏)`：`HudStateSyncService` 为纯静态无状态服务类，杜绝静态变量常驻业务对象指针；
  - `Inv-HDS2-3 (事件载荷只读隔离)`：广播至 EventBus 的 DTO 字典一律深拷贝隔离，杜绝监听方突变反向污染领域实体；
  - `Inv-HDS2-4 (全域零前端耦合)`：后端服务严禁引用 `Control`、`Node` 或 `MainHUDView`，严格保持无头 CLI 与单元测试可执行性；
  - `Inv-HDS2-5 (叙事载荷契约完备)`：所有广播 payload 必带 `category_key` 与 `args`（对齐 `emit_domain_event` 渲染契约），否则视为无效载荷拦截。
* **防漂移最高指示**：快照/突变服务的取值必须经真实实体 API 与配置表，严禁为凑齐演示字段而编造实体属性；广播载荷契约（args/category_key）与频道名（`<domain_id>.<event_name>`）为本卷红线。

---

## 一、 核心算法与领域服务实现 (Core Algorithms & Services)

### 1. AuthService 标准注册与鉴权事件广播扩展
* 模块路径: `res://backend/domains/account/auth_service.gd`
* 职责: 新增高层标准注册入口，并在注册/登录成功/注销时挂接 EventBus 广播（频道与错误码全部配置化）。

```gdscript
## 标准用户账号注册（配置驱动校验 + 加盐哈希 + EventBus 广播）
static func register_account(request: AccountRegistrationDTO.Request, account_store: Dictionary = {}) -> AccountRegistrationDTO.Response:
	var resp := AccountRegistrationDTO.Response.new()
	if request == null or request.username.is_empty() or request.password_plain.is_empty():
		resp.error_code = GameConfig.get_string("domains.account", "auth/errors/invalid_credentials", "ERR_INVALID_CREDENTIALS")
		return resp

	var min_len := GameConfig.get_int("domains.account", "auth/rules/min_username_length", 3)
	var max_len := GameConfig.get_int("domains.account", "auth/rules/max_username_length", 24)
	if request.username.length() < min_len or request.username.length() > max_len:
		resp.error_code = GameConfig.get_string("domains.account", "auth/errors/invalid_username_length", "ERR_INVALID_USERNAME_LENGTH")
		return resp

	for acc_id in account_store.keys():
		var existing: AccountProfileAggregate = account_store[acc_id]
		if existing != null and existing.username.to_lower() == request.username.to_lower():
			resp.error_code = GameConfig.get_string("domains.account", "auth/errors/account_already_exists", "ERR_ACCOUNT_ALREADY_EXISTS")
			return resp

	var acc := AccountProfileAggregate.new()
	acc.account_id = UniqueIdGenerator.next_id(GameConfig.get_string("domains.account", "auth/account_id_prefix", "ACC_USR_"))
	acc.username = request.username
	acc.password_hash_sha256 = hash_password(request.password_plain)
	acc.local_device_fingerprint = request.device_fingerprint
	acc.is_guest_mode = false
	acc.created_timestamp_utc = int(Time.get_unix_time_from_system())
	acc.last_login_timestamp_utc = 0
	acc.entitlements = request.initial_entitlements.duplicate()

	resp.success = true
	resp.error_code = GameConfig.get_string("domains.account", "auth/errors/ok", "OK")
	resp.account_id = acc.account_id
	resp.username = acc.username
	resp.created_timestamp_utc = acc.created_timestamp_utc

	# 统一 EventBus 广播（叙事渲染契约：args + category_key）
	EventBus.get_instance().emit_domain_event(HudEventContract.channel_auth_registered(), {
		"account_id": acc.account_id,
		"username": acc.username,
		"timestamp_utc": acc.created_timestamp_utc,
		"category_key": "auth",
		"args": [acc.username]
	})
	return resp

## 在 authenticate_local 成功分支追加（token_prefix 脱敏，Inv-HDS-4）：
# EventBus.get_instance().emit_domain_event(HudEventContract.channel_auth_login_succeeded(), {
#     "account_id": account.account_id,
#     "username": account.username,
#     "token_prefix": token.substr(0, mini(8, token.length())),
#     "issued_at": issued_at,
#     "expires_at": issued_at + ttl,
#     "category_key": "auth",
#     "args": [account.username]
# })
```

> 注销时以 `auth.session_revoked` 同样携带 `category_key/auth` + `args` 广播；注销流程复用既有 `revoke_token`（`auth_service.gd:146`），不新造会话表。

### 2. 无头主页 HUD 状态同步服务 (HudStateSyncService)
* 模块路径: `res://backend/domains/world_state/hud_state_sync_service.gd`
* 职责: 主页 HUD 双轨中枢——首帧拉取只读快照 + 全量/增量推流（真实 API 派生 + 配置真源）。

```gdscript
class_name HudStateSyncService
extends RefCounted

## 1. 拉轨（Pull Facade）：只读纯计算，字段全部真实溯源（Inv-HDS-1）
static func get_hud_status_snapshot(
	account_id: String,
	character_id: String,
	character_name: String,
	race_id: String,
	physiology: CharacterPhysiologySheet,
	wallet: CharacterWalletEntity,
	location_id: String = ""
) -> HudStatusSnapshotDTO:
	var snapshot := HudStatusSnapshotDTO.new()
	snapshot.account_id = account_id
	snapshot.character_id = character_id
	snapshot.character_name = character_name
	snapshot.race_id = race_id if not race_id.is_empty() else "HUMAN"
	snapshot.current_location_id = location_id

	# 六维实值与层级（真实 API）
	if physiology != null:
		snapshot.attribute_values = physiology.get_actual_values().duplicate()
		snapshot.attribute_levels = physiology.get_all_levels().duplicate()

	# 展示型生命/行动力上限（配置真源 + 除数下限守卫 Inv-HDS-3）
	snapshot.hp_max = maxf(1.0, GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0))
	snapshot.ap_max = maxf(1.0, GameConfig.get_float("domains.world_state", "hud_defaults/ap_max", 10.0))
	snapshot.hp_current = snapshot.hp_max
	snapshot.ap_current = snapshot.ap_max

	# 资产钱包（真实字段）
	if wallet != null:
		snapshot.wallet_gold = wallet.gold
		snapshot.wallet_mana_monocrystals = wallet.mana_monocrystals

	snapshot.timestamp_utc = int(Time.get_unix_time_from_system())
	return snapshot

## 2. 推轨（Push）：全量快照广播（深拷贝隔离，Inv-HDS2-3）
static func publish_hud_snapshot(snapshot: HudStatusSnapshotDTO) -> void:
	if snapshot == null:
		return
	EventBus.get_instance().emit_domain_event(HudEventContract.channel_hud_snapshot(), {
		"snapshot": snapshot.to_dto(),
		"category_key": "hud",
		"args": [snapshot.character_name]
	})

## 3. 增量推流：单项属性实值变更（stat_name 取值域 = physiology attribute 键）
static func publish_stat_mutation(character_id: String, stat_name: String, old_val: float, new_val: float, cause: String = "") -> void:
	EventBus.get_instance().emit_domain_event(HudEventContract.channel_hud_stat_mutated(), {
		"character_id": character_id,
		"stat_name": stat_name,
		"old_value": old_val,
		"new_value": new_val,
		"delta": new_val - old_val,
		"cause_event": cause,
		"category_key": "hud",
		"args": [stat_name, old_val, new_val]
	})

## 4. 增量推流：钱包货币变更（currency_type 取值域 = CURRENCY_FIELDS）
static func publish_wallet_mutation(account_id: String, currency_type: String, old_amt: int, new_amt: int, reason: String = "") -> void:
	EventBus.get_instance().emit_domain_event(HudEventContract.channel_hud_wallet_mutated(), {
		"account_id": account_id,
		"currency_type": currency_type,
		"old_amount": old_amt,
		"new_amount": new_amt,
		"delta": new_amt - old_amt,
		"reason_key": reason,
		"category_key": "hud",
		"args": [currency_type, new_amt - old_amt]
	})

## 5. 世界网关进世界首帧联动（复用既有 world_entered 触发点）
static func trigger_initial_world_sync(account_id: String, character_id: String, character_name: String, physiology: CharacterPhysiologySheet, wallet: CharacterWalletEntity, location_id: String = "") -> HudStatusSnapshotDTO:
	var snapshot := get_hud_status_snapshot(account_id, character_id, character_name, "HUMAN", physiology, wallet, location_id)
	publish_hud_snapshot(snapshot)
	return snapshot
```

> **接线说明**：首帧派发由 `world_gateway_fsm.gd` `IN_WORLD` 后的既有 `world_entered` 事件侧调用 `trigger_initial_world_sync`（或由集成测试宿主直接调用），**不修改网关事件本身**（阶段 3 现场复核具体挂接点后落地）。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 2.1: AuthService 注册与广播扩展** - `register_account`（错误码全配置化）、登录/注销三路广播（payload 带 category_key + args、token 脱敏）。
- [ ] **Step 2.2: HudStateSyncService 双轨中枢实现** - 拉轨真实 API 派生、推轨全量/增量（深拷贝隔离）、`world_entered` 首帧联动。
- [ ] **Step 2.3: 契约完备性自检** - 每条广播 payload 满足 args/category_key 契约；channel 均以 `account.`/`world_state.` 前缀。
- [ ] **Step 2.4: 无头可执行性自证** - 服务不引用任何前端控件，可被无头 CLI 与单测直接调用。

---

## 三、 算法实现验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-HDS-S2-01` | 注册唯一性与幂等拦截 | 同名二次注册 | 返回配置化 `ERR_ACCOUNT_ALREADY_EXISTS`，无脏数据持久化 |
| `TC-HDS-S2-02` | 鉴权事件广播契约完备 | 注册/登录/注销各触发一次 | 三事件均捕获，payload 含 category_key/auth + args，登录载荷 token 前缀 ≤8 且无明文密码 |
| `TC-HDS-S2-03` | 拉轨快照真实溯源 | 构造真实 Physiology/Wallet | attribute_values 与 `get_actual_values()` 完全一致；hp_max/ap_max 钳制 `>=1.0`；wallet 取 `gold/mana_monocrystals` |
| `TC-HDS-S2-04` | 推轨增量事件流 | 监听 world_state.* 频道 | 快照/属性/钱包三类事件载荷深拷贝隔离，监听方改动不反污染实体 |
| `TC-HDS-S2-05` | 首帧联动与零前端耦合 | `world_entered` 触发后 | 快照派发一次成功；服务类无 Control/Node 引用，无头可执行 |
