# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/dto/kdata_toc_entry_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: BinaryConfigReader, GameConfig | 下游: StreamPeerBuffer, Dictionary | 配置: 无 | 信号: 无
# 职责说明: .kdat 全库单包融合模式 (Monolithic Bundle) 下 TOC 目录条目 DTO；
#           负责各子表名称、内存偏移量、压缩长度与解压尺寸的高速寻址装配。
# 退出语义与设计依据: 工业级二进制容器规约与单一职责解耦契约 (GOV-DAT-001)
# ==============================================================================

## KDataTOCEntryDTO：.kdat 单包融合 TOC 目录索引条目数据传输对象
class_name KDataTOCEntryDTO
extends RefCounted

# ==============================================================================
# 一、核心传输字段
# ==============================================================================

var table_name: String = ""
var offset: int = 0
var length: int = 0
var uncompressed_length: int = 0
var crc32: int = 0

# ==============================================================================
# 二、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================

## 复位对象内部字段，满足循环零堆分配池化要求
func reset_state() -> void:
	table_name = ""
	offset = 0
	length = 0
	uncompressed_length = 0
	crc32 = 0

# ==============================================================================
# 三、字典转换与装配契约 (形参 <= 5)
# ==============================================================================

## 序列化为结构化字典
func to_dict() -> Dictionary:
	return {
		"table_name": table_name,
		"offset": offset,
		"length": length,
		"uncompressed_length": uncompressed_length,
		"crc32": crc32
	}

## 从字典数据构造并装配 DTO 实例
static func from_dict(data: Dictionary) -> KDataTOCEntryDTO:
	var dto := KDataTOCEntryDTO.new()
	dto.table_name = str(data.get("table_name", ""))
	dto.offset = int(data.get("offset", 0))
	dto.length = int(data.get("length", 0))
	dto.uncompressed_length = int(data.get("uncompressed_length", 0))
	dto.crc32 = int(data.get("crc32", 0))
	return dto
