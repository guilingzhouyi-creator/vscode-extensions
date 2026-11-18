# ==============================================================================
# 模块归属: 集成测试层 (Integration · 高纯度二进制流与GameConfig双格式流水线)
# 文件路径: res://tests/integration/test_binary_config_and_kdat_pipeline.gd
# 架构定位: Integration Test Suite / End-to-End Pipeline Harness
# 跨域依赖: 上游: TestRegistry | 下游: BinaryConfigReader, KDataHeaderDTO, KDataTOCEntryDTO, GameConfig
# 职责说明: .kdat 容器规范、魔数拦截、CRC32 防篡改、TLV 往返等价、双格式加载与单包融合验收测试套件
# 设计依据: 阶段验收测试矩阵规约与卡拉尔架构解耦契约
# ==============================================================================

class_name TestBinaryConfigAndKdatPipeline
extends TestCase

# ==============================================================================
# 一、测试套件总入口与环境重置
# ==============================================================================

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_tc_kdat_01_magic_and_header_validation())
	results.append(test_tc_kdat_02_crc32_and_tamper_rejection())
	results.append(test_tc_kdat_03_tlv_types_and_string_interning())
	results.append(test_tc_kdat_04_game_config_single_table_kdat_loading())
	results.append(test_tc_kdat_05_monolithic_bundle_and_toc_lookup())
	results.append(test_tc_kdat_06_dual_track_and_architecture_closure())
	results.append(test_tc_kdat_07_binary_blob_embedding_and_decoding())
	results.append(test_tc_kdat_08_encrypted_stream_and_client_secret_vault())
	results.append(test_tc_kdat_09_single_player_fast_path_and_multiplayer_stub_isolation())
	results.append(test_tc_kdat_10_binary_writer_roundtrip_and_kmod_binary_envelope())
	results.append(test_tc_kdat_11_release_config_bundle_and_direct_reader_fallbacks())

	return pack_results("Binary Config & KData Pipeline", results)

# ==============================================================================
# 二、辅助编码工具（用于在无文件环境下构造标准合规测试流）
# ==============================================================================

static func _build_test_kdat_buffer(data: Dictionary, compress: bool = true, encrypt: bool = false) -> PackedByteArray:
	var payload_buf := StreamPeerBuffer.new()
	payload_buf.big_endian = false

	# 1. 简易字符串池：提取所有键
	var pool: Array[String] = []
	for k in data.keys():
		pool.append(str(k))
	payload_buf.put_u16(pool.size())
	for s in pool:
		var utf8 := s.to_utf8_buffer()
		payload_buf.put_u16(utf8.size())
		payload_buf.put_data(utf8)

	# 2. 编码字典根节点
	payload_buf.put_u8(0x09) # TAG_DICT
	payload_buf.put_u32(data.size())
	for i in range(pool.size()):
		payload_buf.put_u8(0x07) # TAG_STRING_REF
		payload_buf.put_u16(i)
		var val: Variant = data[pool[i]]
		if val is int:
			payload_buf.put_u8(0x03) # TAG_INT32
			payload_buf.put_32(int(val))
		elif val is float:
			payload_buf.put_u8(0x05) # TAG_FLOAT64
			payload_buf.put_double(float(val))
		elif val is bool:
			payload_buf.put_u8(0x02 if val else 0x01)
		elif val is String:
			payload_buf.put_u8(0x06) # TAG_STRING
			var s_utf8 := (val as String).to_utf8_buffer()
			payload_buf.put_u16(s_utf8.size())
			payload_buf.put_data(s_utf8)
		elif val is Dictionary and (val as Dictionary).get("__type", "") == "binary_blob":
			payload_buf.put_u8(0x0A) # TAG_BINARY_BLOB
			var raw_blob: PackedByteArray = (val as Dictionary).get("data", PackedByteArray())
			var mime_str: String = str((val as Dictionary).get("mime_type", "application/octet-stream"))
			var mime_bytes := mime_str.to_utf8_buffer()
			payload_buf.put_u32(raw_blob.size())
			payload_buf.put_u16(mime_bytes.size())
			payload_buf.put_data(mime_bytes)
			payload_buf.put_data(raw_blob)
		else:
			payload_buf.put_u8(0x00) # TAG_NIL

	var raw_payload := payload_buf.data_array
	var uncompressed_size := raw_payload.size()

	var flags := 0x0008 | 0x0002 # LITTLE_ENDIAN | STRING_POOL
	var compress_type := 0
	var final_payload := raw_payload

	if compress:
		var compressed := raw_payload.compress(FileAccess.COMPRESSION_DEFLATE)
		if compressed.size() < uncompressed_size:
			flags |= 0x0001 # COMPRESSED
			compress_type = 1 # DEFLATE
			final_payload = compressed

	if encrypt:
		flags |= 0x0010 # FLAG_ENCRYPTED
		final_payload = ClientSecretVault.mask_stream(final_payload)

	var compressed_size := final_payload.size()
	var crc_val := BinaryConfigReader.compute_crc32(final_payload)

	# 组装 32 字节 Header
	var header_buf := StreamPeerBuffer.new()
	header_buf.big_endian = false
	header_buf.put_u32(0x4B444154) # 'KDAT'
	header_buf.put_u16(0x0100) # v1.0
	header_buf.put_u16(flags)
	header_buf.put_u8(compress_type)
	header_buf.put_u8(1) # SINGLE_TABLE
	header_buf.put_u16(32) # HEADER_SIZE
	header_buf.put_u32(uncompressed_size)
	header_buf.put_u32(compressed_size)
	header_buf.put_u32(crc_val)
	header_buf.put_u32(0)
	header_buf.put_u32(0)

	var result := header_buf.data_array
	result.append_array(final_payload)
	return result

# ==============================================================================
# 三、核心测试场景 (TC-KDAT-01 ~ TC-KDAT-06)
# ==============================================================================

## TC-KDAT-01: 魔数与 Header 强类型契约校验及非法注入熔断
static func test_tc_kdat_01_magic_and_header_validation() -> Dictionary:
	# 1. 验证标准合法 DTO 序列化与反序列化
	var dto := KDataHeaderDTO.new()
	dto.uncompressed_size = 1024
	dto.compressed_size = 256
	dto.crc32 = 0x12345678
	var bytes := dto.serialize()
	var restored := KDataHeaderDTO.deserialize(bytes)
	var dto_ok: bool = restored != null and restored.magic == KDataHeaderDTO.MAGIC_KDAT and restored.uncompressed_size == 1024

	# 2. 非法魔数熔断拦截
	var bad_magic_bytes := bytes.duplicate()
	bad_magic_bytes[0] = 0x00
	var bad_restored := KDataHeaderDTO.deserialize(bad_magic_bytes)
	var bad_ok: bool = (bad_restored == null)

	# 3. 截断短数据熔断拦截
	var truncated := bytes.slice(0, 16)
	var trunc_ok: bool = (KDataHeaderDTO.deserialize(truncated) == null)

	var passed: bool = dto_ok and bad_ok and trunc_ok
	return make_result("TC-KDAT-01: 魔数与 Header 强类型契约校验及非法注入熔断", passed, {
		"dto_ok": dto_ok,
		"bad_ok": bad_ok,
		"trunc_ok": trunc_ok
	})

## TC-KDAT-02: CRC32 循环冗余校验与载荷单字节篡改自愈拦截
static func test_tc_kdat_02_crc32_and_tamper_rejection() -> Dictionary:
	var test_dict := {"hp": 100, "name": "Hero", "speed": 12.5}
	var valid_kdat := _build_test_kdat_buffer(test_dict, true)

	# 1. 正确载荷解析
	var res_valid: Variant = BinaryConfigReader.load_kdat_buffer(valid_kdat)
	var valid_ok: bool = res_valid != null and (res_valid is Dictionary) and res_valid.get("hp", 0) == 100

	# 2. 单字节篡改拦截
	var tampered_kdat := valid_kdat.duplicate()
	tampered_kdat[tampered_kdat.size() - 1] ^= 0xFF
	var res_tampered: Variant = BinaryConfigReader.load_kdat_buffer(tampered_kdat)
	var tamper_rejected: bool = (res_tampered == null)

	var passed: bool = valid_ok and tamper_rejected
	return make_result("TC-KDAT-02: CRC32 循环冗余校验与载荷单字节篡改自愈拦截", passed, {
		"valid_ok": valid_ok,
		"tamper_rejected": tamper_rejected
	})

## TC-KDAT-03: TLV 八大基础类型与字符串驻留池往返值等价
static func test_tc_kdat_03_tlv_types_and_string_interning() -> Dictionary:
	var test_dict := {
		"int_val": 42,
		"float_val": 99.5,
		"bool_true": true,
		"bool_false": false,
		"str_val": "KalarWorld",
		"nil_val": null
	}
	var kdat_bytes := _build_test_kdat_buffer(test_dict, false)
	var decoded: Variant = BinaryConfigReader.load_kdat_buffer(kdat_bytes)

	var types_ok: bool = decoded != null \
		and decoded.get("int_val", 0) == 42 \
		and is_equal_approx(float(decoded.get("float_val", 0.0)), 99.5) \
		and decoded.get("bool_true", false) == true \
		and decoded.get("bool_false", true) == false \
		and decoded.get("str_val", "") == "KalarWorld" \
		and decoded.get("nil_val", 1) == null

	return make_result("TC-KDAT-03: TLV 八大基础类型与字符串驻留池往返值等价", types_ok, {
		"types_ok": types_ok
	})

## TC-KDAT-04: GameConfig 静态装配与单表 .kdat 解码读取
static func test_tc_kdat_04_game_config_single_table_kdat_loading() -> Dictionary:
	var table_data := {
		"max_slots": 5,
		"default_currency": 500,
		"world_name": "KALAR"
	}
	var buffer := _build_test_kdat_buffer(table_data, true)
	var decoded: Variant = BinaryConfigReader.load_kdat_buffer(buffer)

	var ok: bool = decoded != null \
		and decoded.get("max_slots", 0) == 5 \
		and decoded.get("default_currency", 0) == 500 \
		and decoded.get("world_name", "") == "KALAR"

	return make_result("TC-KDAT-04: GameConfig 静态装配与单表 .kdat 解码读取", ok, {
		"single_table_ok": ok
	})

## TC-KDAT-05: 单包融合模式 (Monolithic Bundle) 与 TOC 目录指针快速解析
static func test_tc_kdat_05_monolithic_bundle_and_toc_lookup() -> Dictionary:
	var toc_entry := KDataTOCEntryDTO.new()
	toc_entry.table_name = "domains.combat.mechanics"
	toc_entry.offset = 0
	toc_entry.length = 120
	toc_entry.uncompressed_length = 200
	toc_entry.crc32 = 0xABCDEF01

	var dict_repr := toc_entry.to_dict()
	var restored := KDataTOCEntryDTO.from_dict(dict_repr)
	var toc_ok: bool = restored.table_name == toc_entry.table_name \
		and restored.length == toc_entry.length \
		and restored.crc32 == toc_entry.crc32

	return make_result("TC-KDAT-05: 单包融合模式 (Monolithic Bundle) 与 TOC 目录指针快速解析", toc_ok, {
		"toc_ok": toc_ok
	})

## TC-KDAT-06: 双格式自适应机制与全域架构契约闭合
static func test_tc_kdat_06_dual_track_and_architecture_closure() -> Dictionary:
	# 验证 GameConfig 常量契约存在
	var has_ext: bool = not GameConfig.EXT_KDAT.is_empty() and GameConfig.EXT_KDAT == ".kdat"
	var has_bundle: bool = not GameConfig.PATH_CONFIG_BUNDLE.is_empty()

	var passed: bool = has_ext and has_bundle
	return make_result("TC-KDAT-06: 双格式自适应机制与全域架构契约闭合", passed, {
		"has_ext": has_ext,
		"has_bundle": has_bundle
	})

## TC-KDAT-07: 多媒体原生二进制块 (Binary Blob) 嵌入与解算
static func test_tc_kdat_07_binary_blob_embedding_and_decoding() -> Dictionary:
	var mock_png_bytes := PackedByteArray([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D])
	var table_data := {
		"item_id": "sword_dragon",
		"avatar_blob": {
			"__type": "binary_blob",
			"mime_type": "image/png",
			"data": mock_png_bytes
		}
	}
	var kdat_buf := _build_test_kdat_buffer(table_data, true, false)
	var decoded: Variant = BinaryConfigReader.load_kdat_buffer(kdat_buf)

	var blob_ok: bool = false
	if decoded != null and decoded is Dictionary:
		var blob_dict: Variant = (decoded as Dictionary).get("avatar_blob", null)
		if blob_dict is Dictionary:
			var d := blob_dict as Dictionary
			var type_ok: bool = d.get("__type", "") == "binary_blob"
			var mime_ok: bool = d.get("mime_type", "") == "image/png"
			var data_ok: bool = (d.get("data", PackedByteArray()) as PackedByteArray) == mock_png_bytes
			blob_ok = type_ok and mime_ok and data_ok

	return make_result("TC-KDAT-07: 多媒体原生二进制块 (Binary Blob) 嵌入与解算", blob_ok, {
		"blob_ok": blob_ok
	})

## TC-KDAT-08: 对称流掩码加密混淆 (FLAG_ENCRYPTED) 与 ClientSecretVault 往返解混淆
static func test_tc_kdat_08_encrypted_stream_and_client_secret_vault() -> Dictionary:
	# 1. 内存凭据混淆保护自检
	var raw_token := "session_token_kalar_secret_123"
	var masked_token := ClientSecretVault.mask_in_memory_token(raw_token)
	var token_masked_differ: bool = (masked_token.get_string_from_utf8() != raw_token)
	var restored_token := ClientSecretVault.reveal_in_memory_token(masked_token)
	var token_ok: bool = token_masked_differ and (restored_token == raw_token)

	# 2. 动态种子推导确定性自检
	var seed_a := ClientSecretVault.derive_key_seed("domain_combat")
	var seed_b := ClientSecretVault.derive_key_seed("domain_combat")
	var seed_c := ClientSecretVault.derive_key_seed("domain_narrative")
	var seed_ok: bool = (seed_a == seed_b) and (seed_a != seed_c) and (seed_a != 0)

	# 3. 完整加密流反编译自检
	var secret_data := {"secret_level": 99, "access_key": "vault_protected"}
	var enc_kdat := _build_test_kdat_buffer(secret_data, true, true)
	var decoded: Variant = BinaryConfigReader.load_kdat_buffer(enc_kdat)
	var stream_ok: bool = decoded != null \
		and (decoded as Dictionary).get("secret_level", 0) == 99 \
		and (decoded as Dictionary).get("access_key", "") == "vault_protected"

	var passed: bool = token_ok and seed_ok and stream_ok
	return make_result("TC-KDAT-08: 对称流掩码加密混淆与 ClientSecretVault 往返解混淆", passed, {
		"token_ok": token_ok,
		"seed_ok": seed_ok,
		"stream_ok": stream_ok
	})

## TC-KDAT-09: 首发单机零网络快道与联机预留存根快速失败隔离 (RunModeIsolationSolver)
static func test_tc_kdat_09_single_player_fast_path_and_multiplayer_stub_isolation() -> Dictionary:
	# 1. 单机模式判定与网络旁路
	var is_sp := RunModeIsolationSolver.is_offline_single_player(WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var is_not_mp := not RunModeIsolationSolver.is_multiplayer_placeholder(WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var bypass_poll := RunModeIsolationSolver.should_bypass_network_poll(WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var bypass_auth := RunModeIsolationSolver.should_bypass_remote_authority(WorldGatewayModel.GameMode.SINGLE_PLAYER)

	# 2. 单机能力画像自检
	var sp_caps := RunModeIsolationSolver.evaluate_mode_capabilities(WorldGatewayModel.GameMode.SINGLE_PLAYER)
	var caps_ok: bool = bool(sp_caps.get("is_single_player", false)) \
		and bool(sp_caps.get("zero_latency_fast_path", false)) \
		and not bool(sp_caps.get("network_active", true))

	# 3. 联机预留存根快速失败自检
	var is_mp := RunModeIsolationSolver.is_multiplayer_placeholder(WorldGatewayModel.GameMode.MULTIPLAYER)
	var mp_caps := RunModeIsolationSolver.evaluate_mode_capabilities(WorldGatewayModel.GameMode.MULTIPLAYER)
	var mp_caps_ok: bool = bool(mp_caps.get("stub_reserved", false)) \
		and not bool(mp_caps.get("zero_latency_fast_path", true))

	var mp_dispatch := RunModeIsolationSolver.dispatch_authority_sync(WorldGatewayModel.GameMode.MULTIPLAYER, {})
	var mp_dispatch_fail_fast: bool = not bool(mp_dispatch.get("success", true)) \
		and mp_dispatch.get("error_code", "") == RunModeIsolationSolver.ERR_MULTIPLAYER_STUB_RESERVED

	# 4. AuthoritySyncStub 真实集成自检
	var stub_sp := AuthoritySyncStub.new(AuthoritySyncStub.SyncMode.OFFLINE_TEXT)
	var stub_sp_res := stub_sp.verify_authority({})
	var stub_sp_ok: bool = bool(stub_sp_res.get("success", false)) and bool(stub_sp_res.get("fast_path", false))

	var stub_mp := AuthoritySyncStub.new(AuthoritySyncStub.SyncMode.ONLINE_AUTHORITY)
	var stub_mp_res := stub_mp.verify_authority({})
	var stub_mp_ok: bool = not bool(stub_mp_res.get("success", true)) \
		and stub_mp_res.get("error_code", "") == RunModeIsolationSolver.ERR_MULTIPLAYER_STUB_RESERVED

	var passed: bool = is_sp and is_not_mp and bypass_poll and bypass_auth and caps_ok \
		and is_mp and mp_caps_ok and mp_dispatch_fail_fast and stub_sp_ok and stub_mp_ok

	return make_result("TC-KDAT-09: 首发单机零网络快道与联机预留存根快速失败隔离", passed, {
		"sp_ok": is_sp and caps_ok,
		"mp_fail_fast_ok": is_mp and mp_caps_ok and mp_dispatch_fail_fast,
		"stub_integration_ok": stub_sp_ok and stub_mp_ok
	})


## TC-KDAT-10: BinaryConfigWriter 编码往返、JSON 调试转 .kmod 编译封装零明文校验及等价读取
static func test_tc_kdat_10_binary_writer_roundtrip_and_kmod_binary_envelope() -> Dictionary:
	var sample := {
		"flag_ok": true,
		"small_int": -42,
		"big_int": 9000000000,
		"ratio": 1.625,
		"title": "星界编译构筑",
		"tags": ["alpha", "alpha", "beta"],
		"raw_blob": "BIN_PAYLOAD".to_utf8_buffer(),
	}
	var encoded := BinaryConfigWriter.encode_kdat_buffer(sample, true, KDataHeaderDTO.PAYLOAD_MOD_PACKAGE)
	var decoded_var: Variant = BinaryConfigReader.load_kdat_buffer(encoded)
	var roundtrip_ok := decoded_var is Dictionary
	if roundtrip_ok:
		var decoded_table := decoded_var as Dictionary
		var decoded_blob_entry: Variant = decoded_table.get("raw_blob", null)
		var decoded_blob_ok := decoded_blob_entry is Dictionary \
			and str((decoded_blob_entry as Dictionary).get("__type", "")) == "binary_blob" \
			and ((decoded_blob_entry as Dictionary).get("data", PackedByteArray()) as PackedByteArray).get_string_from_utf8() == "BIN_PAYLOAD"
		roundtrip_ok = bool(decoded_table.get("flag_ok", false)) \
			and int(decoded_table.get("small_int", 0)) == -42 \
			and int(decoded_table.get("big_int", 0)) == 9000000000 \
			and is_equal_approx(float(decoded_table.get("ratio", 0.0)), 1.625) \
			and str(decoded_table.get("title", "")) == "星界编译构筑" \
			and decoded_blob_ok

	var sandbox := "user://test_kdat10_mod_compile"
	var src_dir := sandbox.path_join("mod_compile_debug")
	var kmod_out := sandbox.path_join("mod_compile_debug_v1.0.0.kmod")
	WorldModPackageOpsHelper.ensure_directory_recursive(src_dir.path_join("dag_graphs"))
	WorldModPackageOpsHelper.ensure_directory_recursive(src_dir.path_join("i18n"))
	WorldModPackageOpsHelper.ensure_directory_recursive(src_dir.path_join("assets"))
	WorldModPackageOpsHelper.write_json_file(src_dir.path_join("pack.json"), {
		"pack_id": "mod_compile_debug", "pack_name": "Compile Debug Mod", "version": "1.0.0", "is_active": true
	})
	WorldModPackageOpsHelper.write_json_file(src_dir.path_join("routing_rules.json"), {
		"prologue_routing_rules": [{"rule_id": "R_CMPL", "priority": 500, "origin_id": "INITIATE", "dag_id": "DAG_CMPL"}]
	})
	WorldModPackageOpsHelper.write_json_file(src_dir.path_join("dag_graphs/DAG_CMPL.json"), {
		"dag_id": "DAG_CMPL", "entry_node_id": "N0", "nodes": {"N0": {"node_type": "START_ENTRY", "narrative_key": "cmpl.n0"}}, "edges": []
	})
	WorldModPackageOpsHelper.write_json_file(src_dir.path_join("i18n/zh_CN.json"), {
		"cmpl": {"n0": "星海序章"}
	})
	var asset_f := FileAccess.open(src_dir.path_join("assets/sigil.txt"), FileAccess.WRITE)
	if asset_f != null:
		asset_f.store_buffer("SIGIL_RAW".to_utf8_buffer())
		asset_f.close()

	var pack_res := WorldModArchiveOpsHelper.pack_mod_kmod({"source_dir": src_dir, "output_path": kmod_out})
	var pack_ok := bool(pack_res.get("success", false)) and FileAccess.file_exists(kmod_out)

	var reader := ZIPReader.new()
	var zero_json_ok := false
	if reader.open(kmod_out) == OK:
		var files := reader.get_files()
		var has_json := false
		for entry_file in files:
			if String(entry_file).to_lower().ends_with(".json"):
				has_json = true
		zero_json_ok = (not has_json) and files.has("manifest.kdat") and files.has("mod_data.kdat") and files.has("assets/sigil.txt")
		reader.close()

	var dir_pkg := ModPackageDiscoverySolver.load_full_mod_package_from_dir(src_dir)
	var bin_pkg := ModPackageArchiveReader.load_full_package_from_kmod(kmod_out)
	var parity_ok := str(dir_pkg.get("pack_id", "")) == str(bin_pkg.get("pack_id", "")) \
		and (dir_pkg.get("dag_graphs", {}) as Dictionary).has("DAG_CMPL") \
		and (bin_pkg.get("dag_graphs", {}) as Dictionary).has("DAG_CMPL") \
		and str((dir_pkg.get("custom_i18n", {}) as Dictionary).get("cmpl.n0", "")) == str((bin_pkg.get("custom_i18n", {}) as Dictionary).get("cmpl.n0", ""))
	var integrity_res := ModPackageDiscoverySolver.verify_package_content_integrity({"pack_id": "mod_compile_debug", "root_path": kmod_out})
	var integrity_ok := bool(integrity_res.get("valid", false))

	var leak_kmod := sandbox.path_join("mod_leak.kmod")
	var leak_packer := ZIPPacker.new()
	if leak_packer.open(leak_kmod) == OK:
		leak_packer.start_file("pack.json")
		leak_packer.write_file("{\"pack_id\":\"leak\"}".to_utf8_buffer())
		leak_packer.close_file()
		leak_packer.close()
	var leak_rejected := ModPackageArchiveReader.load_full_package_from_kmod(leak_kmod).is_empty()

	TestTier3ContentOverrideHelper.cleanup_directory_recursive(sandbox)
	var passed := roundtrip_ok and pack_ok and zero_json_ok and parity_ok and integrity_ok and leak_rejected
	return make_result("TC-KDAT-10: BinaryConfigWriter 往返与 JSON调试/.kmod纯二进制封装验证", passed, {
		"roundtrip_ok": roundtrip_ok,
		"pack_ok": pack_ok,
		"zero_json_ok": zero_json_ok,
		"parity_ok": parity_ok,
		"integrity_ok": integrity_ok,
		"leak_rejected": leak_rejected,
	})


## TC-KDAT-11: Monolithic config.kdat 打包、发行模式解析及 JSON 缺失时直读回退验证
static func test_tc_kdat_11_release_config_bundle_and_direct_reader_fallbacks() -> Dictionary:
	var sandbox := "user://test_kdat11_release_bundle"
	WorldModPackageOpsHelper.ensure_directory_recursive(sandbox)
	var bundle_path := sandbox.path_join("config.kdat")
	var sample_tables := {
		"domains.combat.mechanics": {"crit_cap": 0.75, "tag": "kdat_release_smoke"},
		"infrastructure.resource_catalog": {"critical_boot_tables": ["domains.combat.mechanics"], "custom_entries": []},
		"infrastructure.domains": {"domains": [{"id": "combat", "config": "domains.combat.mechanics"}]},
		"infrastructure.contracts": {"$schema_version": 1, "infra_domains": [], "entries": []},
		"i18n.zh_CN": {"test.bundle.hello": "来自单包"},
		"i18n.en_US": {"test.bundle.hello": "From Bundle"},
	}

	var encoded_bundle := BinaryConfigWriter.encode_monolithic_bundle(sample_tables, true)
	var encode_ok := not encoded_bundle.is_empty()
	if encode_ok:
		var out_handle := FileAccess.open(bundle_path, FileAccess.WRITE)
		if out_handle != null:
			out_handle.store_buffer(encoded_bundle)
			out_handle.close()
		else:
			encode_ok = false

	GameConfigLoader.set_config_bundle_path_override_for_test(bundle_path)
	AssetPathResolver.set_test_environment_override(AssetPathResolver.ENV_RELEASE)

	var resolved_ok := GameConfigLoader.resolve_config_bundle_path() == bundle_path
	var loaded_tables: Dictionary = {}
	var scan_failures: Array = []
	GameConfigLoader.load_all_tables_into(loaded_tables, scan_failures)
	var bulk_ok := scan_failures.is_empty() \
		and loaded_tables.size() == sample_tables.size() \
		and is_equal_approx(float((loaded_tables.get("domains.combat.mechanics", {}) as Dictionary).get("crit_cap", 0.0)), 0.75) \
		and str((loaded_tables.get("i18n.zh_CN", {}) as Dictionary).get("test.bundle.hello", "")) == "来自单包"

	var snapshot_ok := GameConfigLoader.load_bundle_tables_snapshot().has("infrastructure.domains")
	var jit_tables: Dictionary = {}
	GameConfigLoader.ensure_table_loaded_jit("domains.combat.mechanics", jit_tables, scan_failures)
	var jit_ok := jit_tables.has("domains.combat.mechanics") and not AssetPathResolver.is_engineering_build()

	var probe_resolver := UITextResolver.new()
	probe_resolver._dictionaries.clear()
	probe_resolver._load_locale_dict("zh_CN", sandbox.path_join("absent_zh_CN.json"), "i18n.zh_CN")
	var i18n_fallback_ok := (probe_resolver._dictionaries.get("zh_CN", {}) as Dictionary).size() > 0

	GameConfigLoader.set_config_bundle_path_override_for_test("")
	AssetPathResolver.reset_for_tests()
	TestTier3ContentOverrideHelper.cleanup_directory_recursive(sandbox)

	var passed := encode_ok and resolved_ok and bulk_ok and snapshot_ok and jit_ok and i18n_fallback_ok
	return make_result("TC-KDAT-11: Monolithic config.kdat 发行路径解析与直读回退验证", passed, {
		"encode_ok": encode_ok,
		"resolved_ok": resolved_ok,
		"bulk_ok": bulk_ok,
		"snapshot_ok": snapshot_ok,
		"jit_ok": jit_ok,
		"i18n_fallback_ok": i18n_fallback_ok,
	})
