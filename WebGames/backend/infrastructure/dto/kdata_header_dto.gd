# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/dto/kdata_header_dto.gd
# 架构定位: Data Transfer Object (DTO)
# 依赖与触发: 上游: BinaryConfigReader, GameConfig | 下游: StreamPeerBuffer, PackedByteArray | 配置: 无 | 信号: 无
# 职责说明: .kdat 高纯度二进制流 32 字节定长 Header 强类型数据传输对象；
#           负责魔数、协议版本、压缩标记与 CRC 校验字段的装配、校验与序列化。
# 退出语义与设计依据: 工业级二进制容器规约与卡拉尔架构解耦契约 (Inv-KDAT-MAGIC-PARITY-1)
# ==============================================================================

## KDataHeaderDTO：.kdat 二进制流定长 Header 数据传输对象
class_name KDataHeaderDTO
extends RefCounted

# ==============================================================================
# 一、协议常量
# ==============================================================================

const MAGIC_KDAT: int = 0x4B444154 # 'K', 'D', 'A', 'T'
const FORMAT_VERSION_1_0: int = 0x0100
const HEADER_SIZE: int = 32

const FLAG_COMPRESSED: int = 0x0001
const FLAG_STRING_POOL: int = 0x0002
const FLAG_MONOLITHIC_TOC: int = 0x0004
const FLAG_LITTLE_ENDIAN: int = 0x0008

const COMPRESS_RAW: int = 0
const COMPRESS_DEFLATE: int = 1
const COMPRESS_ZSTD: int = 2

const PAYLOAD_SINGLE_TABLE: int = 1
const PAYLOAD_MONOLITHIC: int = 2
const PAYLOAD_MOD_PACKAGE: int = 3

# ==============================================================================
# 二、核心传输字段
# ==============================================================================

var magic: int = MAGIC_KDAT
var version: int = FORMAT_VERSION_1_0
var flags: int = FLAG_LITTLE_ENDIAN
var compress_type: int = COMPRESS_RAW
var payload_type: int = PAYLOAD_SINGLE_TABLE
var header_length: int = HEADER_SIZE
var uncompressed_size: int = 0
var compressed_size: int = 0
var crc32: int = 0

# ==============================================================================
# 三、对象池与重置契约 (ADV-PRF-002)
# ==============================================================================

## 复位对象内部字段，满足循环零堆分配池化要求
func reset_state() -> void:
	magic = MAGIC_KDAT
	version = FORMAT_VERSION_1_0
	flags = FLAG_LITTLE_ENDIAN
	compress_type = COMPRESS_RAW
	payload_type = PAYLOAD_SINGLE_TABLE
	header_length = HEADER_SIZE
	uncompressed_size = 0
	compressed_size = 0
	crc32 = 0

# ==============================================================================
# 四、序列化与合法性校验
# ==============================================================================

## 校验 Header 完整性与魔数合法性
func validate() -> bool:
	if magic != MAGIC_KDAT:
		return false
	if version != FORMAT_VERSION_1_0:
		return false
	if header_length != HEADER_SIZE:
		return false
	return true

## 序列化为 32 字节 PackedByteArray
func serialize() -> PackedByteArray:
	var buf := StreamPeerBuffer.new()
	buf.big_endian = false
	buf.put_u32(magic)
	buf.put_u16(version)
	buf.put_u16(flags)
	buf.put_u8(compress_type)
	buf.put_u8(payload_type)
	buf.put_u16(header_length)
	buf.put_u32(uncompressed_size)
	buf.put_u32(compressed_size)
	buf.put_u32(crc32)
	buf.put_u32(0) # 保留字段 1
	buf.put_u32(0) # 保留字段 2
	return buf.data_array

## 从字节数组反序列化并解析 Header（形参 <= 5）
static func deserialize(bytes: PackedByteArray) -> KDataHeaderDTO:
	if bytes.size() < HEADER_SIZE:
		return null
	var buf := StreamPeerBuffer.new()
	buf.data_array = bytes
	buf.big_endian = false

	var dto := KDataHeaderDTO.new()
	dto.magic = buf.get_u32()
	dto.version = buf.get_u16()
	dto.flags = buf.get_u16()
	dto.compress_type = buf.get_u8()
	dto.payload_type = buf.get_u8()
	dto.header_length = buf.get_u16()
	dto.uncompressed_size = buf.get_u32()
	dto.compressed_size = buf.get_u32()
	dto.crc32 = buf.get_u32()

	if not dto.validate():
		return null
	return dto
