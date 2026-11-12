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

static var _tmp_seq: int = 0

static func _next_tmp_id() -> int:
    _tmp_seq += 1
    return _tmp_seq

## 确保目标目录存在（幂等递归创建）
static func ensure_directory(dir_path: String) -> bool:
    if dir_path.is_empty():
        return false
    if DirAccess.dir_exists_absolute(dir_path):
        return true
    return DirAccess.make_dir_recursive_absolute(dir_path) == OK

## 清理目录内遗留的孤儿临时文件，返回实际删除数量
static func cleanup_orphan_tmp_files(dir_path: String, tmp_suffix: String = DEFAULT_TMP_SUFFIX) -> int:
    if dir_path.is_empty() or tmp_suffix.is_empty():
        return 0
    var dir := DirAccess.open(dir_path)
    if dir == null:
        return 0
    var base_dir: String = dir_path if dir_path.ends_with("/") else dir_path + "/"
    var removed: int = 0
    dir.list_dir_begin()
    var fname: String = dir.get_next()
    while not fname.is_empty():
        if not dir.current_is_dir() and fname.ends_with(tmp_suffix):
            if DirAccess.remove_absolute(base_dir + fname) == OK:
                removed += 1
        fname = dir.get_next()
    dir.list_dir_end()
    return removed

## 从指定备份路径经临时文件原子替换恢复目标正档
static func restore_from_backup(file_path: String, bak_path: String) -> bool:
    if file_path.is_empty() or bak_path.is_empty():
        return false
    if not FileAccess.file_exists(bak_path):
        return false
    var fa := FileAccess.open(bak_path, FileAccess.READ)
    if fa == null:
        return false
    var bak_content := fa.get_as_text()
    var read_err := fa.get_error()
    fa.close()
    if read_err != OK and read_err != ERR_FILE_EOF:
        return false
    var res := replace_via_tmp(file_path, bak_content, DEFAULT_TMP_SUFFIX)
    return bool(res.get("success", false))

## 按最大保留代数执行历史备份轮转（.bak -> .bak.1 -> .bak.2 ...）
static func rotate_backups(
    file_path: String,
    backup_suffix: String = DEFAULT_BACKUP_SUFFIX,
    retention: int = DEFAULT_BACKUP_RETENTION
) -> void:
    if file_path.is_empty() or backup_suffix.is_empty() or retention <= 1:
        return
    var idx: int = retention - 1
    while idx >= 1:
        _shift_backup_version(file_path, backup_suffix, idx)
        idx -= 1

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
    tmp_suffix: String = DEFAULT_TMP_SUFFIX
) -> Dictionary:
    return write_text_atomic(file_path, content, {
        "atomic_enabled": true,
        "tmp_suffix": tmp_suffix,
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

    var tmp_suffix: String = str(options.get("tmp_suffix", DEFAULT_TMP_SUFFIX))
    if tmp_suffix.is_empty():
        tmp_suffix = DEFAULT_TMP_SUFFIX
    var tmp_path: String = "%s.%d_%d%s" % [file_path, OS.get_process_id(), _next_tmp_id(), tmp_suffix]
    if not _write_text_handle(tmp_path, content):
        return {
            "success": false,
            "error_stage": "tmp_open",
            "error_code": FileAccess.get_open_error(),
            "backup_error": OK
        }

    var backup_res: Dictionary = _prepare_backup_before_replace(file_path, tmp_path, options)
    if not bool(backup_res.get("ok", false)):
        return {
            "success": false,
            "error_stage": "backup",
            "error_code": int(backup_res.get("backup_error", ERR_FILE_CANT_WRITE)),
            "backup_error": int(backup_res.get("backup_error", ERR_FILE_CANT_WRITE))
        }

    var rename_err: int = DirAccess.rename_absolute(tmp_path, file_path)
    var backup_err: int = int(backup_res.get("backup_error", OK))
    if rename_err != OK:
        DirAccess.remove_absolute(tmp_path)
        return {
            "success": false,
            "error_stage": "rename",
            "error_code": rename_err,
            "backup_error": backup_err
        }
    return {"success": true, "error_stage": "", "error_code": OK, "backup_error": backup_err}

static func _prepare_backup_before_replace(
    file_path: String,
    tmp_path: String,
    options: Dictionary
) -> Dictionary:
    if not bool(options.get("create_backup", true)) or not FileAccess.file_exists(file_path):
        return {"ok": true, "backup_error": OK}

    var backup_suffix: String = str(options.get("backup_suffix", DEFAULT_BACKUP_SUFFIX))
    if backup_suffix.is_empty():
        backup_suffix = DEFAULT_BACKUP_SUFFIX
    var retention: int = int(options.get("backup_retention", DEFAULT_BACKUP_RETENTION))
    rotate_backups(file_path, backup_suffix, retention)

    var bak_path: String = file_path + backup_suffix
    var backup_err: int = DirAccess.copy_absolute(file_path, bak_path)
    if backup_err != OK:
        var policy: String = str(options.get("backup_fail_policy", DEFAULT_BACKUP_FAIL_POLICY))
        if policy == "abort":
            DirAccess.remove_absolute(tmp_path)
            return {"ok": false, "backup_error": backup_err}
    return {"ok": true, "backup_error": backup_err}

static func _write_text_handle(target_path: String, content: String) -> bool:
    var file: FileAccess = FileAccess.open(target_path, FileAccess.WRITE)
    if file == null:
        return false
    file.store_string(content)
    var write_err: int = file.get_error()
    file.flush()
    var flush_err: int = file.get_error()
    file.close()
    return write_err == OK and flush_err == OK

static func _shift_backup_version(file_path: String, bak_suffix: String, version_idx: int) -> void:
    var src: String = file_path + bak_suffix if version_idx == 1 else file_path + bak_suffix + "." + str(version_idx - 1)
    var dst: String = file_path + bak_suffix + "." + str(version_idx)
    if not FileAccess.file_exists(src):
        return
    var staged_old := "%s.shifting_%d" % [dst, _next_tmp_id()]
    var had_dst := FileAccess.file_exists(dst)
    if had_dst:
        if DirAccess.rename_absolute(dst, staged_old) != OK:
            return
    var rename_err := DirAccess.rename_absolute(src, dst)
    if rename_err != OK:
        if had_dst and FileAccess.file_exists(staged_old):
            DirAccess.rename_absolute(staged_old, dst)
    elif had_dst and FileAccess.file_exists(staged_old):
        DirAccess.remove_absolute(staged_old)
