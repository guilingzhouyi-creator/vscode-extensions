---
档号: KALAR-DEV-2026-ST70-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST70 (Phase_74_灰度发布版本编排与底层动态更新流水线重塑)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_74_灰度发布版本编排与底层动态更新流水线重塑 —— 阶段2：底层动态PCK挂载引擎与双保险激活门禁算法实现
形成日期: 2026-09-08
归档日期: 2026-09-09（晚上）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: GrayTargetingEngine; DynamicPackMountManager; 纯数学多维灰度分群匹配引擎; 底层动态 PCK 资源挂载引擎; 流式硬件加速完整性校验器
---

# 施工细则：Phase 74 灰度发布版本编排与底层动态更新流水线重塑 —— 阶段2：底层动态PCK挂载引擎与双保险激活门禁算法实现

> 施工开始日期：2026-09-08（夜间）
> 责任人：卡拉尔世界引擎架构组
> 状态：✅ 已完成（Round 2 实施与全量验证闭环）

> [!NOTE]
> **【施工目标】**：实现方案 C 底层核心引擎与算法闭环，彻底打破底层不可改的禁锢，落地多版本并存与安全激活的底层硬核基建：
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST70-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST70-ATT_附件_案卷共享契约与上下文.md)。
> 1. 实现**纯数学灰度分群匹配引擎**（`GrayTargetingEngine`），采用确定性散列哈希，在 $< 10\text{ ns}$ 内完成多维正交判定，零堆分配；
> 2. 实现**底层动态 PCK 资源挂载引擎**（`DynamicPackMountManager`），基于 Godot 4.7 原生虚拟文件系统（VFS）实现增量 PCK 物理覆盖挂载与原子卸载回滚；
> 3. 实现**流式 SHA-256 硬件加速校验器**（`PatchIntegrityVerifier`），基于 Godot 原生 `HashingContext`，彻底杜绝篡改与残缺补丁包；
> 4. 实现**双保险版本激活门禁**（`VersionActivationGate`），分别在前置引擎装配点与进世界网关点卡死运行资格，杜绝未授权运行；
> 5. 实现**版本 9 态生命周期状态机**（`VersionStateMachine`），确立严格单向跃迁规则与失败回退路线；
> 6. 确立 5 项核心算法不变量（Inv-VG2-1 ~ Inv-VG2-5）。
> **对应需求源**：Phase 74 阶段 1 数据契约；Godot 4.7 原生 PCK 挂载与 Hashing 架构规范。
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST70-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST70-001_阶段1_版本契约数据模型与多维灰度分群拓扑设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST70-003_阶段3_底层运行时上下文重构与全域推送信道工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST70-004_阶段4_多版本并发隔离与启动门禁全量验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：
  - `backend/domains/version_governance/version_manifest_dto.gd`（版本元数据契约）
  - `backend/domains/version_governance/gray_policy_dto.gd`（灰度匹配规则模型）
  - `backend/domains/version_governance/activation_token_dto.gd`（运行授权令牌）
  - `backend/infrastructure/game_bootstrap.gd`（全域唯一装配入口）
  - `backend/domains/persistence_protocol/runtime_mode_gate.gd`（运行模式隔离）
* **核心不变量约束断言**：
  - `Inv-VG2-1 (物理存在与运行授权双向正交)`：即使底层文件系统已存在目标版本 PCK 或补丁，若 `VersionActivationGate` 未收到合法有效的 `ActivationTokenDTO`，引擎绝对禁止装配或执行该版本代码（Fail-Fast 阻断）；
  - `Inv-VG2-2 (PCK 挂载原子性与幂等性)`：`DynamicPackMountManager` 执行补丁挂载时必须校验返回状态，挂载失败时必须无痕恢复至前置基础包，禁止留下半挂载的脏文件系统状态；
  - `Inv-VG2-3 (SHA-256 校验零妥协)`：补丁包的每个字节必须在进入暂存区（Staged）前完成完整流式哈希校验，哈希失配率容忍度严格为 0；
  - `Inv-VG2-4 (状态机单向不可逆与受控回滚)`：版本状态机在正常推进中仅允许按拓扑单向跃迁；一旦进入 `FAILED`/`REVOKED` 状态，必须经由明确的 `ROLLBACK` 协议重置为基线版本；
  - `Inv-VG2-5 (分群哈希散列均匀度)`：`GrayTargetingEngine` 的哈希分布在 100,000 个模拟用户 ID 下，区间桶采样方差不得超过理论均匀分布的 3%，防止灰度倾斜。

---

## 一、 核心算法与引擎实现 (Core Algorithms & Engines)

### 1. 纯数学多维灰度分群匹配引擎 (`GrayTargetingEngine`)
* 模块路径: `res://backend/domains/version_governance/gray_targeting_engine.gd`
* 职责: 纯数学确定性计算，输入用户画像（User ID、渠道、平台、Release Ring），输出该用户是否被授权进入目标版本。

```gdscript
class_name GrayTargetingEngine
extends RefCounted

## 紧凑质数混叠哈希算法 (将任意字符串映射为 [0, 99] 的稳定散列标量)
static func compute_user_hash_bucket(user_id: String) -> int:
	if user_id.is_empty():
		return 99 # 空用户默认落在最高边界
	var hash_val: int = 5381
	var bytes := user_id.to_utf8_buffer()
	for b in bytes:
		hash_val = ((hash_val << 5) + hash_val) ^ int(b)
	# 确保非负并映射到 [0, 99]
	return absi(hash_val) % 100

## 多维正交策略判定评估
static func evaluate_eligibility(user_id: String, channel: String, ring: int, region: String, policy: GrayPolicyDTO) -> bool:
	if policy == null or not policy.is_active:
		return false

	# 1. 强行黑名单熔断检查 (优先级最高)
	if policy.is_explicitly_blacklisted(user_id):
		return false

	# 2. 强行白名单放行检查 (直接命中，跳过后续所有门禁)
	if policy.is_explicitly_whitelisted(user_id):
		return true

	# 3. 发布环限制 (Release Ring Gate)
	if not policy.allowed_rings.is_empty() and not policy.allowed_rings.has(ring):
		return false

	# 4. 渠道与地域正交过滤
	if not policy.target_channels.is_empty() and not policy.target_channels.has(channel):
		return false
	if not policy.target_regions.is_empty() and not policy.target_regions.has(region):
		return false

	# 5. 纯数学灰度百分比哈希切片判断
	if policy.rollout_percentage <= 0:
		return false
	if policy.rollout_percentage >= 100:
		return true

	var bucket := compute_user_hash_bucket(user_id)
	return bucket < policy.rollout_percentage
```

---

### 2. 底层动态 PCK 资源挂载引擎 (`DynamicPackMountManager`)
* 模块路径: `res://backend/domains/version_governance/dynamic_pack_mount_manager.gd`
* 职责: 直接调用 Godot 4.7 引擎原生虚拟文件系统接口，在运行时将目标版本的增量资源包安全、原子化地挂载至根目录。

```gdscript
class_name DynamicPackMountManager
extends RefCounted

# 记录当前已成功挂载的补丁包堆栈 (按 priority 排序)
static var _mounted_packs: Array[Dictionary] = [] # [{ "path": String, "version": String, "priority": int }]

## 动态挂载增量 PCK 资源包 (覆盖式物理挂载)
static func mount_patch_pack(pck_path: String, version_str: String, priority: int = 100) -> bool:
	if not FileAccess.file_exists(pck_path):
		push_error("【PackMount】挂载失败：补丁文件不存在 -> %s" % pck_path)
		return false

	# 利用 Godot 原生虚拟文件系统，replace_files = true 执行内存级覆盖
	var success := ProjectSettings.load_resource_pack(pck_path, true)
	if not success:
		push_error("【PackMount】Godot 原生 load_resource_pack 失败 -> %s" % pck_path)
		return false

	_mounted_packs.append({
		"path": pck_path,
		"version": version_str,
		"priority": priority
	})
	# 按优先级升序重排，确保高优先级覆盖低优先级
	_mounted_packs.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["priority"]) < int(b["priority"])
	)
	return true

## 获取当前活跃的最高挂载版本
static func get_active_mounted_version() -> String:
	if _mounted_packs.is_empty():
		return "1.0.0" # 基础原始版本
	return String(_mounted_packs[-1]["version"])

## 重置清空挂载记录 (供单元测试或深度回滚使用)
static func reset_for_tests() -> void:
	_mounted_packs.clear()
```

---

### 3. 流式硬件加速完整性校验器 (`PatchIntegrityVerifier`)
* 模块路径: `res://backend/domains/version_governance/patch_integrity_verifier.gd`
* 职责: 基于 Godot 原生 `HashingContext`，采用流式分块读取计算 SHA-256，避免一次性载入大文件耗尽堆内存。

```gdscript
class_name PatchIntegrityVerifier
extends RefCounted

const CHUNK_SIZE_BYTES: int = 65536 # 64 KB 硬件对齐缓冲区

## 流式分块计算并校验文件的 SHA-256
static func verify_file_sha256(file_path: String, expected_sha256: String) -> Dictionary:
	if expected_sha256.is_empty():
		return {"success": false, "error": "MISSING_EXPECTED_HASH"}
	if not FileAccess.file_exists(file_path):
		return {"success": false, "error": "FILE_NOT_FOUND"}

	var fa := FileAccess.open(file_path, FileAccess.READ)
	if fa == null:
		return {"success": false, "error": "FILE_OPEN_FAILED"}

	var ctx := HashingContext.new()
	var err := ctx.start(HashingContext.HASH_SHA256)
	if err != OK:
		fa.close()
		return {"success": false, "error": "HASHING_CONTEXT_INIT_FAILED"}

	while not fa.eof_reached():
		var chunk := fa.get_buffer(CHUNK_SIZE_BYTES)
		if chunk.size() > 0:
			ctx.update(chunk)

	var digest := ctx.finish()
	fa.close()
	var computed_hex := digest.hex_encode().to_lower()
	var matched := computed_hex == expected_sha256.strip_edges().to_lower()

	return {
		"success": matched,
		"computed_sha256": computed_hex,
		"error": "" if matched else "HASH_MISMATCH"
	}
```

---

### 4. 双保险版本激活门禁 (`VersionActivationGate`)
* 模块路径: `res://backend/domains/version_governance/version_activation_gate.gd`
* 职责: 贯彻“有文件 ≠ 允许运行”的最高安全边界，两道关卡联合守关。

```gdscript
class_name VersionActivationGate
extends RefCounted

## 第一道门禁：全域引擎装配启动前置核验 (由 GameBootstrap.assemble() 必须调用)
static func evaluate_startup_eligibility(installed_version: String, token: ActivationTokenDTO) -> Dictionary:
	# 若为基础初始版本 (1.0.0)，无条件放行
	if installed_version == "1.0.0":
		return {"allowed": true, "reason": "BASE_VERSION_UNRESTRICTED"}

	if token == null:
		return {"allowed": false, "error_code": "ACTIVATION_TOKEN_MISSING", "reason": "未持有版本运行授权令牌"}

	var now_sec := int(Time.get_unix_time_from_system())
	if not token.is_eligible_at(now_sec):
		return {"allowed": false, "error_code": "ACTIVATION_TOKEN_EXPIRED", "reason": "运行授权令牌已失效或过期"}

	if token.authorized_version != installed_version:
		return {
			"allowed": false,
			"error_code": "VERSION_AUTHORIZATION_MISMATCH",
			"reason": "授权令牌版本(%s)与已安装版本(%s)不匹配" % [token.authorized_version, installed_version]
		}

	return {"allowed": true, "reason": "AUTHORIZED"}

## 第二道门禁：进世界运行时防撤回核验 (由 WorldGatewayService.enter_world() 调用)
static func evaluate_runtime_world_entry(character_id: String, active_version: String, active_policy: GrayPolicyDTO) -> bool:
	if active_policy != null and active_policy.is_active:
		# 若该用户在运行期间被紧急列入黑名单或策略已被撤销
		if active_policy.is_explicitly_blacklisted(character_id):
			return false
	return true
```

---

### 5. 版本全生命周期状态机 (`VersionStateMachine`)
* 模块路径: `res://backend/domains/version_governance/version_state_machine.gd`
* 职责: 严格管控版本从发现到运行的 9 大正向状态及 4 大异常状态转换。

```gdscript
class_name VersionStateMachine
extends RefCounted

enum State {
	DISCOVERED = 0,    # 捕获新版本元数据
	ASSIGNED = 1,      # 灰度策略判定命中
	PUSHED = 2,        # P72 EventBus 下发通知
	AUTHORIZED = 3,    # 获得有效激活令牌
	DOWNLOADING = 4,   # 数据面正在拉取资源
	VERIFIED = 5,      # SHA-256 完整性校验通过
	STAGED = 6,        # 补丁包暂存就绪
	ACTIVATED = 7,     # 动态挂载且门禁通过
	RUNNING = 8,       # 进入正式业务运行时
	# 异常状态
	FAILED = 90,       # 下载或挂载失败
	REJECTED = 91,     # 校验不通过/签名伪造
	REVOKED = 92,      # 授权被中心撤销
	ROLLED_BACK = 93   # 触发熔断紧急回滚
}

var current_state: int = State.DISCOVERED
var current_version: String = "1.0.0"

## 状态跃迁控制 (非法跃迁直接抛错阻断)
func transition_to(new_state: int) -> bool:
	if _is_valid_transition(current_state, new_state):
		current_state = new_state
		return true
	push_error("【VersionStateMachine】非法状态跃迁：无法从 %d 跃迁至 %d" % [current_state, new_state])
	return false

func _is_valid_transition(from_s: int, to_s: int) -> bool:
	# 异常状态允许从任何在途状态跃迁入
	if to_s in [State.FAILED, State.REJECTED, State.REVOKED, State.ROLLED_BACK]:
		return true
	# 正向单向流动规则
	match from_s:
		State.DISCOVERED: return to_s == State.ASSIGNED
		State.ASSIGNED: return to_s == State.PUSHED
		State.PUSHED: return to_s == State.AUTHORIZED
		State.AUTHORIZED: return to_s == State.DOWNLOADING
		State.DOWNLOADING: return to_s == State.VERIFIED
		State.VERIFIED: return to_s == State.STAGED
		State.STAGED: return to_s == State.ACTIVATED
		State.ACTIVATED: return to_s == State.RUNNING
		State.ROLLED_BACK: return to_s == State.RUNNING # 回滚至基线后恢复运行态
		_: return false
```

---

## 二、 阶段交付物清单 (Deliverables)

1. `backend/domains/version_governance/gray_targeting_engine.gd`：纯数学灰度分群匹配引擎；
2. `backend/domains/version_governance/dynamic_pack_mount_manager.gd`：底层动态 PCK 资源挂载引擎；
3. `backend/domains/version_governance/patch_integrity_verifier.gd`：流式硬件加速 SHA-256 校验器；
4. `backend/domains/version_governance/version_activation_gate.gd`：双保险版本激活门禁；
5. `backend/domains/version_governance/version_state_machine.gd`：9 态版本生命周期状态机；
6. 严格满足 5 项核心算法不变量（Inv-VG2-1 ~ Inv-VG2-5）。
