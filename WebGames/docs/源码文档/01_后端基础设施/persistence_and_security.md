# 原子持久化、纯计算域库与安全防线 (`persistence_and_security`)

> 对应源码：`backend/infrastructure/` 下文件原子写入、存档校验、客户端内存混淆、`pure/` 纯计算库与 `robustness/` 幂等防线共 **8 个**脚本。

---

## 一、模块清单与职责界定

| 文件路径 | 核心类 | 架构定位 | 核心公开接口 |
| :--- | :--- | :--- | :--- |
| [atomic_file_writer.gd](../../../backend/infrastructure/atomic_file_writer.gd) | `AtomicFileWriter` | 崩溃安全文件写入原语 | `ensure_directory()`、`cleanup_orphan_tmp_files()`、`rotate_backups()`、`replace_via_tmp()`、`restore_from_backup()`、`write_text_direct()` |
| [save_manager.gd](../../../backend/infrastructure/save_manager.gd) | `SaveManager` | 存档信封调度门面 | `ensure_save_directory()`、`is_valid_save_name()`、`save_game()`、`load_game()`、`restore_backup()`、`compute_sha256()` |
| [authority_sync_stub.gd](../../../backend/infrastructure/authority_sync_stub.gd) | `AuthoritySyncStub` | 联机权威校验预留存根 | `verify_authority()`、`diff_snapshot()`、`current_sync_mode()` |
| [client_secret_vault.gd](../../../backend/infrastructure/client_secret_vault.gd) | `ClientSecretVault` | 客户端无硬编码密钥混淆器 | `mask_stream()`、`unmask_stream()`、`derive_key_seed()`、`mask_in_memory_token()`、`reveal_in_memory_token()` |
| [crypto_integrity_lib.gd](../../../backend/infrastructure/pure/crypto_integrity_lib.gd) | `CryptoIntegrityLib` | 纯密码学与完整性算子库 | `sha256_hex()`、`salted_hash_hex()`、`hmac_sha256_*()`、`constant_time_equals()`、`derive_subkey_32()`、`derive_key_32()`、`resolve_seal_key_bytes()` 及 AES-256-CBC Encrypt-then-MAC 加解密 |
| [statistics_math_lib.gd](../../../backend/infrastructure/pure/statistics_math_lib.gd) | `StatisticsMathLib` | 纯统计与字符串洗净算子库 | `compute_percentile_from_sorted()`、`compute_p50_p95()`、`ring_next_cursor()`、`mask_string()`、`scrub_inline_secrets()`、`extract_caller_from_stack()` |
| [backend_robustness_guard.gd](../../../backend/infrastructure/robustness/backend_robustness_guard.gd) | `BackendRobustnessGuard` | 边界输入净化与异常归类 | `sanitize_int()`、`sanitize_float()`、`sanitize_string()`、`sanitize_dict()`、`sanitize_array()`、`classify_error()` |
| [idempotency_controller.gd](../../../backend/infrastructure/robustness/idempotency_controller.gd) | `IdempotencyController` | 有界滑动窗口幂等控制器 | `check_and_record()`、`has_token()`、`get_result()`、`reset()`、`history_size()` |

---

## 二、存档与密码学核心契约

1. **单字段防绕过存档信封**（`SaveManager`）：
   - 依据 `infrastructure.persistence` 配置存档路径、扩展名（`.kalar_save`）、信封版本与保留策略。
   - 序列化后的 `data_dict` 仅以单一字符串字段 `data_json` 写入信封，并计算 SHA-256 存入 `signature_sha256`；禁止构造平行 `data` 字典字段，彻底封堵“篡改 `data` 绕过 `data_json` 摘要校验”漏洞。
   - 严格拒收无签名历史信封（返回 `INVALID_ENVELOPE`）；文件名黑名单拦截 `/`、`\`、`..` 等目录穿越片段。
2. **三阶段原子替换协议**（`AtomicFileWriter`）：
   - 写入递增编号的 `.tmp` 文件并校验流结束状态；
   - 按 `backup_retention` 轮转现有主档至 `.bak` / `.bak.1`；
   - 执行原子重命名覆盖目标路径；若进程意外中断，下次启动经 `cleanup_orphan_tmp_files()` 清理残余 `.tmp`。
3. **秘密隔离与时序防侧信道**（`CryptoIntegrityLib` + `ClientSecretVault`）：
   - 日志/存档审计主密钥仅由 `resolve_seal_key_bytes()` 按 `GameConfig` 指定的环境变量名读取，严禁配置明文落盘。
   - `constant_time_equals()` 始终完整遍历两侧字节最大长度并异或累积差异，避免校验提前短路泄露摘要前缀。
   - 客户端会话令牌由 `ClientSecretVault` 采用 FNV-1a 派生的 32 位上下文种子进行流掩码保护，不在进程堆留存长期明文。

---

## 三、关联测试

- [test_save_domain_contracts.gd](../../../tests/unit/infrastructure/test_save_domain_contracts.gd)
- [test_save_consistency_recovery.gd](../../../tests/unit/infrastructure/test_save_consistency_recovery.gd)
- [test_backend_robustness_guard.gd](../../../tests/guards/test_backend_robustness_guard.gd)
- [test_bounded_cache_and_idempotency.gd](../../../tests/unit/infrastructure/test_bounded_cache_and_idempotency.gd)
