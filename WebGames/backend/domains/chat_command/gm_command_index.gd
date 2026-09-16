# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/chat_command/gm_command_index.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/chat_command.json | 信号: EventBus 领域广播
# 职责说明: 维护 GM 命令最近使用索引（MRU 窗口，默认仅最近 20 条）、分页滚动 （页缓冲池回收复用，内存有界）与「最近适配补全」解析 参数由 config/domains/chat_command.json 的 gm_index 段驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GmCommandIndexSolver
extends RefCounted

# ==============================================================================
# 配置读取（零硬编码：数值一律经 GameConfig，代码值仅作防御回退）
# ==============================================================================

## MRU 窗口大小（gm_index/window_size 配置，默认 20）
static func _window_size() -> int:
	return GameConfig.get_int("domains.chat_command", "gm_index/window_size", 20)

## 分页大小（gm_index/page_size 配置，默认 5）
static func _page_size() -> int:
	return GameConfig.get_int("domains.chat_command", "gm_index/page_size", 5)

## 页缓冲池容量上限（gm_index/max_pages 配置，默认 4）
static func _max_pages() -> int:
	return GameConfig.get_int("domains.chat_command", "gm_index/max_pages", 4)

## 默认命令目录（gm_index/default_commands 配置，窗口为空时兜底）
static func _default_commands() -> Array:
	return GameConfig.get_array("domains.chat_command", "gm_index/default_commands", ["give", "gold", "god", "time"])

# ==============================================================================
# 状态（全部有界：窗口 ≤ window_size，页池 ≤ max_pages）
# ==============================================================================

# MRU 最近命令窗口：最近使用在前，窗口溢出从尾部回收（pop_back 即回收语义）
var _recent_commands: Array[String] = []
# 页缓冲池：固定容量 max_pages 的复用数组，查询/滚动时取池中页复用，避免反复分配
var _page_pool: Array = []
# 池轮转指针：页回收复用策略（round-robin 复用最旧页）
var _pool_rotor: int = 0
# 当前滚动页游标（0 基），next_page / prev_page 驱动
var _cursor_page: int = 0

## 记录一条命令使用（MRU 去重置顶 + 窗口截断回收）：
## 重复使用会提升到最近位；窗口溢出时从尾部回收最旧条目。
func record_usage(command_name: String) -> void:
	var name := _normalize(command_name)
	if name.is_empty():
		return
	_recent_commands.erase(name)
	_recent_commands.push_front(name)
	var limit := maxi(1, _window_size())
	while _recent_commands.size() > limit:
		_recent_commands.pop_back()

## 最近命令窗口条目数
func recent_count() -> int:
	return _recent_commands.size()

## 页缓冲池已用容量
func page_pool_size() -> int:
	return _page_pool.size()

## 查询补全页：前缀过滤「最近窗口」，窗口为空时回退默认命令目录；
## 返回的 entries 来自回收页缓冲池（同一次查询内的数组对象会被后续查询复用）。
func query(prefix: String) -> Dictionary:
	var matched := _filtered(prefix)
	var total: int = min(matched.size(), _window_size())
	var page_sz := maxi(1, _page_size())
	var total_pages := ceili(float(total) / float(page_sz)) if total > 0 else 0
	_cursor_page = clampi(_cursor_page, 0, maxi(0, total_pages - 1))
	var entries := _take_page_buffer()
	if total_pages > 0:
		var start := _cursor_page * page_sz
		for i in range(start, min(start + page_sz, total)):
			entries.append(matched[i])
	return {
		"success": true,
		"entries": entries,
		"total": total,
		"page_index": _cursor_page,
		"total_pages": total_pages,
		"page_size": page_sz
	}

## 滚动到下一页 / 上一页（复用页缓冲池，游标有界）
func next_page(prefix: String) -> Dictionary:
	_cursor_page += 1
	return query(prefix)

## 滚动到上一页（游标有界，负越界回首页）
func prev_page(prefix: String) -> Dictionary:
	_cursor_page -= 1
	return query(prefix)

## 重置滚动游标到首页
func reset_cursor() -> void:
	_cursor_page = 0

## 最近适配补全：返回最近使用中首个前缀匹配的命令（MRU 序），未命中返回空
func apply_recent_completion(prefix: String) -> Dictionary:
	var matched := _filtered(prefix)
	if matched.is_empty():
		return { "success": false, "command": "" }
	return { "success": true, "command": "/" + str(matched[0]) }

# ==============================================================================
# 内部实现
# ==============================================================================

static func _normalize(cmd: String) -> String:
	var name := cmd.strip_edges().to_lower()
	if name.begins_with("/"):
		name = name.substr(1)
	return name

## 候选目录：最近窗口非空取最近（MRU），否则回退默认命令目录
func _catalog() -> Array:
	if not _recent_commands.is_empty():
		return _recent_commands.duplicate()
	return _default_commands()

## 前缀过滤候选目录（去 / 前缀 + 小写化，空前缀返回全目录）
func _filtered(prefix: String) -> Array:
	var key := prefix.strip_edges().to_lower()
	if key.begins_with("/"):
		key = key.substr(1)
	var catalog := _catalog()
	if key.is_empty():
		return catalog
	var out: Array = []
	for cmd in catalog:
		if str(cmd).begins_with(key):
			out.append(cmd)
	return out

## 从页缓冲池取页：池未满则新建（容量上限 max_pages），满则轮转复用最旧页
func _take_page_buffer() -> Array:
	var pool_limit := maxi(1, _max_pages())
	var page: Array
	if _page_pool.size() < pool_limit:
		page = []
		_page_pool.append(page)
	else:
		page = _page_pool[_pool_rotor]
		_pool_rotor = (_pool_rotor + 1) % pool_limit
	page.clear()
	return page
