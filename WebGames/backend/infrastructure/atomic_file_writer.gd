# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Atomic File Persistence)
# 文件路径: res://backend/infrastructure/atomic_file_writer.gd
# 架构定位: Persistence Primitive / Crash-Safe Atomic Writer
# 依赖与触发: 上游: SaveManager, AccountRepository, WorldArchiveRepository, WorldModAffinityManager | 下游: FileAccess, DirAccess | 配置: 由调用方传入策略选项 | 信号: 无
# 职责说明: 收口全后端目录创建、孤儿临时文件清理、多代备份轮转、临时文件写入及原子重命名替换原语。
# 退出语义与设计依据: 事务型存档原子写入规范 (先写 .tmp -> 备份 .bak -> rename 原子替换)
# ==============================================================================

## AtomicFileWriter：跨领域统一 crash-safe 原子文件读写原语
class_name AtomicFileWriter
extends RefCounted

const DEFAULT_TMP_SUFFIX: String = ".tmp"
const DEFAULT_BACKUP_SUFFIX: String = ".bak"
const DEFAULT_BACKUP_RETENTION: int = 1
const DEFAULT_BACKUP_FAIL_POLICY: String = "continue"

static var _temporary_sequence_number: int = 0

static func _next_temporary_id() -> int:
    _temporary_sequence_number += 1
    return _temporary_sequence_number

## 确保目标目录存在（幂等递归创建）
static func ensure_directory(dir_path: String) -> bool:
    if dir_path.is_empty():
        return false
    if DirAccess.dir_exists_absolute(dir_path):
        return true
    return DirAccess.make_dir_recursive_absolute(dir_path) == OK

## 清理目录内遗留的孤儿临时文件，返回实际删除数量
static func cleanup_orphan_tmp_files(dir_path: String, temporary_suffix: String = DEFAULT_TMP_SUFFIX) -> int:
    if dir_path.is_empty() or temporary_suffix.is_empty():
        return 0
    var dir_access := DirAccess.open(dir_path)
    if dir_access == null:
        return 0
    var base_dir: String = dir_path if dir_path.ends_with("/") else dir_path + "/"
    var removed_count: int = 0
    dir_access.list_dir_begin()
    var file_name: String = dir_access.get_next()
    while not file_name.is_empty():
        if not dir_access.current_is_dir() and file_name.ends_with(temporary_suffix):
            if DirAccess.remove_absolute(base_dir + file_name) == OK:
                removed_count += 1
        file_name = dir_access.get_next()
    dir_access.list_dir_end()
    return removed_count

## 从指定备份路径经临时文件原子替换恢复目标正档
static func restore_from_backup(file_path: String, backup_path: String) -> bool:
    if file_path.is_empty() or backup_path.is_empty():
        return false
    if not FileAccess.file_exists(backup_path):
        return false
    var file_handle := FileAccess.open(backup_path, FileAccess.READ)
    if file_handle == null:
        return false
    var backup_content := file_handle.get_as_text()
    var read_error := file_handle.get_error()
    file_handle.close()
    if read_error != OK and read_error != ERR_FILE_EOF:
        return false
    var replace_result := replace_via_tmp(file_path, backup_content, DEFAULT_TMP_SUFFIX)
    return bool(replace_result.get("success", false))

## 按最大保留代数执行历史备份轮转（.bak -> .bak.1 -> .bak.2 ...）
static func rotate_backups(
    file_path: String,
    backup_suffix: String = DEFAULT_BACKUP_SUFFIX,
    retention: int = DEFAULT_BACKUP_RETENTION
) -> void:
    if file_path.is_empty() or backup_suffix.is_empty() or retention <= 1:
        return
    # 从最老一代倒序平移，防止覆盖尚未迁移的上一代备份文件
    var backup_index: int = retention - 1
    while backup_index >= 1:
        _shift_backup_version(file_path, backup_suffix, backup_index)
        backup_index -= 1

## 将文本直接写入目标路径（无临时文件与备份保护）
static func write_text_direct(file_path: String, content: String) -> Dictionary:
    if file_path.is_empty():
        return {"success": false, "error_stage": "open_write", "error_code": ERR_INVALID_PARAMETER, "backup_error": OK}
    ensure_directory(file_path.get_base_dir())
    if not _write_text_handle(file_path, content):
        return {
            "success": false,
            "error_stage": "open_write",
            "error_code": FileAccess.get_open_error(),
            "backup_error": OK
        }
    return {"success": true, "error_stage": "", "error_code": OK, "backup_error": OK}

## 经临时文件中转并原子 rename 覆盖目标路径（用于恢复等无需重新备份正档的交换）
static func replace_via_tmp(
    file_path: String,
    content: String,
    temporary_suffix: String = DEFAULT_TMP_SUFFIX
) -> Dictionary:
    return write_text_atomic(file_path, content, {
        "atomic_enabled": true,
        "tmp_suffix": temporary_suffix,
        "create_backup": false
    })

## 事务级原子写：目录准备 -> 写 .tmp -> 可选备份与轮转 -> rename 原子替换
## options 支持: atomic_enabled(bool), tmp_suffix(String), create_backup(bool),
## backup_suffix(String), backup_retention(int), backup_fail_policy(String)
static func write_text_atomic(
    file_path: String,
    content: String,
    options: Dictionary = {}
) -> Dictionary:
    if file_path.is_empty():
        return {"success": false, "error_stage": "open_write", "error_code": ERR_INVALID_PARAMETER, "backup_error": OK}

    var atomic_enabled: bool = bool(options.get("atomic_enabled", true))
    if not atomic_enabled:
        return write_text_direct(file_path, content)

    ensure_directory(file_path.get_base_dir())

    var temporary_suffix: String = str(options.get("tmp_suffix", DEFAULT_TMP_SUFFIX))
    if temporary_suffix.is_empty():
        temporary_suffix = DEFAULT_TMP_SUFFIX
    # 拼入进程 ID 与进程内单调序号，避免同目录并发写手互相覆盖临时文件
    var temporary_path: String = "%s.%d_%d%s" % [file_path, OS.get_process_id(), _next_temporary_id(), temporary_suffix]
    if not _write_text_handle(temporary_path, content):
        return {
            "success": false,
            "error_stage": "tmp_open",
            "error_code": FileAccess.get_open_error(),
            "backup_error": OK
        }

    var backup_result: Dictionary = _prepare_backup_before_replace(file_path, temporary_path, options)
    if not bool(backup_result.get("ok", false)):
        return {
            "success": false,
            "error_stage": "backup",
            "error_code": int(backup_result.get("backup_error", ERR_FILE_CANT_WRITE)),
            "backup_error": int(backup_result.get("backup_error", ERR_FILE_CANT_WRITE))
        }

    var rename_error: int = DirAccess.rename_absolute(temporary_path, file_path)
    var backup_error: int = int(backup_result.get("backup_error", OK))
    if rename_error != OK:
        DirAccess.remove_absolute(temporary_path)
        return {
            "success": false,
            "error_stage": "rename",
            "error_code": rename_error,
            "backup_error": backup_error
        }
    return {"success": true, "error_stage": "", "error_code": OK, "backup_error": backup_error}

static func _prepare_backup_before_replace(
    file_path: String,
    temporary_path: String,
    options: Dictionary
) -> Dictionary:
    if not bool(options.get("create_backup", true)) or not FileAccess.file_exists(file_path):
        return {"ok": true, "backup_error": OK}

    var backup_suffix: String = str(options.get("backup_suffix", DEFAULT_BACKUP_SUFFIX))
    if backup_suffix.is_empty():
        backup_suffix = DEFAULT_BACKUP_SUFFIX
    var retention: int = int(options.get("backup_retention", DEFAULT_BACKUP_RETENTION))
    rotate_backups(file_path, backup_suffix, retention)

    var backup_path: String = file_path + backup_suffix
    var backup_error: int = DirAccess.copy_absolute(file_path, backup_path)
    if backup_error != OK:
        var policy: String = str(options.get("backup_fail_policy", DEFAULT_BACKUP_FAIL_POLICY))
        if policy == "abort":
            DirAccess.remove_absolute(temporary_path)
            return {"ok": false, "backup_error": backup_error}
    return {"ok": true, "backup_error": backup_error}

static func _write_text_handle(target_path: String, content: String) -> bool:
    var file: FileAccess = FileAccess.open(target_path, FileAccess.WRITE)
    if file == null:
        return false
    file.store_string(content)
    var write_error: int = file.get_error()
    file.flush()
    var flush_error: int = file.get_error()
    file.close()
    return write_error == OK and flush_error == OK

static func _shift_backup_version(file_path: String, backup_suffix: String, version_index: int) -> void:
    var source_path: String = file_path + backup_suffix if version_index == 1 else file_path + backup_suffix + "." + str(version_index - 1)
    var destination_path: String = file_path + backup_suffix + "." + str(version_index)
    if not FileAccess.file_exists(source_path):
        return
    # 先把既有目标备份移至暂存名，防止 rename 失败时原备份丢失
    var staged_old := "%s.shifting_%d" % [destination_path, _next_temporary_id()]
    var had_destination := FileAccess.file_exists(destination_path)
    if had_destination:
        if DirAccess.rename_absolute(destination_path, staged_old) != OK:
            return
    var rename_error := DirAccess.rename_absolute(source_path, destination_path)
    if rename_error != OK:
        if had_destination and FileAccess.file_exists(staged_old):
            DirAccess.rename_absolute(staged_old, destination_path)
    elif had_destination and FileAccess.file_exists(staged_old):
        DirAccess.remove_absolute(staged_old)
