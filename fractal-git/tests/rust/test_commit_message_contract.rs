//! Test Suite: Commit Message Slot Resolution, Lexicon and Style Contract
//! File Path: tests/rust/test_commit_message_contract.rs
//!
//! These tests pin the behaviours that separate a usable gate from one authors route around:
//! the authoring template's own spelling must pass, legitimate engineering vocabulary must not be
//! rejected as slang, and every rule that claims to fire must actually fire.

use fractal_git::{CommitMessageGuard, TaxisPolicy};

/// A message written exactly the way the authoring template tells people to write it.
const TEMPLATE_CONFORMANT: &str = r#"feat(gate): 新增提交信息区块槽位解析与双语别名

[Project / 项目归属]
- fractal-git

[Why / 动机背景]
- 门禁按字面量比较区块名，导致模板推荐的双名写法被误判为缺少区块。

[Added / 新增内容]
- 新增语义槽位解析与双语别名表。

[Verification / 验证结论]
- 断言双名区块与单名区块解析到同一槽位。
"#;

#[test]
fn template_spelling_with_dual_name_heading_passes() {
    let policy = TaxisPolicy::workspace_strict();
    let result = CommitMessageGuard::parse_and_verify(TEMPLATE_CONFORMANT, &policy, None);
    assert!(
        result.is_ok(),
        "the spelling recommended by the authoring template must pass: {:?}",
        result.err()
    );
}

#[test]
fn bilingual_single_name_headings_pass() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"fix(gate): 修复区块名比较导致的模板写法误杀

[项目归属]
- fractal-git

[动机]
- 模板推荐双名写法，门禁却按字面量比较区块名。

[修复]
- 改为按语义槽位匹配双语别名。

[验证]
- 断言双语单名区块解析到对应槽位。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    assert!(
        result.is_ok(),
        "Chinese-only headings must resolve to the same slots: {:?}",
        result.err()
    );
}

#[test]
fn added_slot_satisfies_the_change_obligation() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- 门禁需要一个能识别双语区块的解析层。

[Added]
- 新增槽位枚举与别名解析。

[Verification]
- 断言新增内容区块满足变更义务。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    assert!(
        result.is_ok(),
        "a pure addition must not be forced to invent a [Changed] section: {:?}",
        result.err()
    );
}

#[test]
fn legitimate_engineering_terms_survive_the_vocabulary_scan() {
    let policy = TaxisPolicy::workspace_strict();
    // "template" contains "temp", and "临时文件" is whitelisted engineering vocabulary.
    let message = r#"feat(gate): 新增提交模板渲染与临时文件清理

[Project] fractal-git

[Why]
- 提交模板需要渲染字段，临时文件需要在构建后回收。

[Added]
- 新增模板渲染与临时文件清理逻辑。

[Verification]
- 断言模板缺字段时报错，临时文件清理后目录为空。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    assert!(
        result.is_ok(),
        "'template' must not be rejected for containing 'temp', and whitelisted terms must pass: {:?}",
        result.err()
    );
}

#[test]
fn unauthorized_project_prefix_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git-evil

[Why]
- 枚举校验必须精确匹配而不是前缀匹配。

[Added]
- 新增槽位枚举与别名解析。

[Verification]
- 断言未授权项目标识被拒绝。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        !error.is_empty(),
        "a project name that merely starts with an authorized one must be rejected"
    );
    assert!(
        error.contains("FGT-MSG-007"),
        "the rejection must name the project scope rule: {error}"
    );
}

#[test]
fn unresolved_marker_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- TODO 待补充具体的技术背景说明。

[Added]
- 新增槽位枚举与别名解析能力。

[Verification]
- 断言槽位解析在缺字段时返回明确错误。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-005"),
        "an unresolved marker must be rejected: {error}"
    );
}

#[test]
fn template_placeholder_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增 <scope> 区块槽位解析能力

[Project] fractal-git

[Why]
- 模板尖括号残留必须被门禁识别并阻断。

[Added]
- 新增槽位枚举与别名解析能力。

[Verification]
- 断言残留占位符被拒绝且给出明确诊断。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-005"),
        "an unreplaced template placeholder must be rejected: {error}"
    );
}

#[test]
fn batch_codename_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力 phase2

[Project] fractal-git

[Why]
- 批次代号不携带任何技术信息。

[Added]
- 新增槽位枚举与别名解析能力。

[Verification]
- 断言批次代号被门禁识别并阻断提交。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-008"),
        "a construction batch codename must be rejected: {error}"
    );
}

#[test]
fn empty_shell_section_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- 空壳区块会让门禁在什么都没说的情况下通过。

[Added]

[Verification]
- 断言空壳区块被识别并阻断提交。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-006"),
        "a section carrying only a heading must be rejected: {error}"
    );
}

#[test]
fn optimization_did_not_change_whitelist_behaviour() {
    // These cases cover the code paths that were rewritten for speed: the whitelist subtraction
    // early exit, the borrowed-slice tokenizer, and the sorted vocabulary tables. If an optimization
    // changed which terms are accepted, one of these flips.
    let policy = TaxisPolicy::workspace_strict();

    let accepted = [
        ("临时文件", "whitelisted compound must survive subtraction"),
        ("占位内容", "whitelisted placeholder compound must survive"),
        (
            "绝对路径",
            "whitelisted absolute-path compound must survive",
        ),
        (
            "commit template",
            "a legitimate word containing a short provisional stem must survive",
        ),
    ];
    for (phrase, reason) in accepted {
        let message = format!(
            "feat(gate): 新增提交信息校验与{phrase}处理\n\n[Project] fractal-git\n\n\
             [Why]\n- 门禁需要处理{phrase}相关的边界情况并保持判定一致。\n\n\
             [Added]\n- 新增与{phrase}相关的校验逻辑与用例。\n\n\
             [Verification]\n- 断言{phrase}场景返回明确的通过或拒绝结果。"
        );
        let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
        assert!(result.is_ok(), "{reason}: {:?}", result.err());
    }

    let rejected = ["wip", "hack", "placeholder", "垃圾", "完美"];
    for term in rejected {
        let message = format!(
            "feat(gate): 新增提交信息校验逻辑\n\n[Project] fractal-git\n\n\
             [Why]\n- 需要处理 {term} 相关的边界情况并保持判定一致。\n\n\
             [Added]\n- 新增与该场景相关的校验逻辑与用例。\n\n\
             [Verification]\n- 断言该场景返回明确的通过或拒绝结果。"
        );
        let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
        assert!(
            result.is_err(),
            "the vocabulary table must still reject '{term}' after the sorted-lookup rewrite"
        );
    }
}

#[test]
fn thin_why_section_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- 说明。

[Added]
- 新增槽位枚举与双语别名解析能力。

[Verification]
- 断言槽位解析在缺字段时返回明确错误。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-003"),
        "a section too thin to state a fact must be rejected: {error}"
    );
}

#[test]
fn stub_bullet_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- 门禁需要能识别双语区块的解析层以避免误判模板写法。

[Added]
- 加。

[Verification]
- 断言槽位解析在缺字段时返回明确错误。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-003"),
        "a bullet that says nothing must be rejected: {error}"
    );
}

#[test]
fn first_person_pronoun_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 新增区块槽位解析能力

[Project] fractal-git

[Why]
- 我们此前按字面量比较区块名。

[Added]
- 新增槽位枚举与别名解析能力。

[Verification]
- 断言槽位解析结果与预期一致。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-004"),
        "a first-person pronoun must be rejected: {error}"
    );
}

#[test]
fn narrative_subject_is_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let message = r#"feat(gate): 已修复了区块名比较问题

[Project] fractal-git

[Why]
- 区块名比较需要按语义槽位进行。

[Added]
- 新增槽位枚举与别名解析能力。

[Verification]
- 断言槽位解析结果与预期一致。
"#;
    let result = CommitMessageGuard::parse_and_verify(message, &policy, None);
    let error = result
        .err()
        .map(|rejection| format!("{rejection:?}"))
        .unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-004"),
        "a narrative past-tense subject must be rejected: {error}"
    );
}

#[test]
fn uppercase_commit_type_is_rejected_due_to_case_sensitivity() {
    let policy = TaxisPolicy::workspace_strict();
    let message = TEMPLATE_CONFORMANT.replace("feat(gate):", "FEAT(gate):");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    let error = result.err().map(|e| format!("{e:?}")).unwrap_or_default();
    assert!(
        error.contains("GUARD-MSG-001"),
        "uppercase type must be rejected: {error}"
    );
}

#[test]
fn breaking_change_bang_requires_breaking_changes_section() {
    let policy = TaxisPolicy::workspace_strict();
    let message = TEMPLATE_CONFORMANT.replace("feat(gate):", "feat(gate)!:");
    let result = CommitMessageGuard::parse_and_verify(&message, &policy, None);
    let error = result.err().map(|e| format!("{e:?}")).unwrap_or_default();
    assert!(
        error.contains("FGT-MSG-002") && error.contains("Breaking Changes"),
        "breaking change header must require [Breaking Changes] section: {error}"
    );

    let compliant_breaking = TEMPLATE_CONFORMANT
        .replace("feat(gate):", "feat(gate)!:")
        .replace(
            "[Verification",
            "[Breaking Changes]\n- 升级门禁接口契约与返回值定义适配指南。\n\n[Verification",
        );
    let ok_res = CommitMessageGuard::parse_and_verify(&compliant_breaking, &policy, None);
    assert!(
        ok_res.is_ok(),
        "breaking commit with section must pass: {:?}",
        ok_res.err()
    );
}

#[test]
fn feat_commit_requires_added_section_and_refactor_requires_changed() {
    let policy = TaxisPolicy::workspace_strict();
    let feat_with_changed_only =
        TEMPLATE_CONFORMANT.replace("[Added / 新增内容]", "[Changed / 变更调整]");
    let feat_err = CommitMessageGuard::parse_and_verify(&feat_with_changed_only, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        feat_err.contains("FGT-MSG-002") && feat_err.contains("[Added]"),
        "feat commit must require [Added] section: {feat_err}"
    );

    let refactor_with_added_only = TEMPLATE_CONFORMANT.replace("feat(gate):", "refactor(gate):");
    let refactor_err =
        CommitMessageGuard::parse_and_verify(&refactor_with_added_only, &policy, None)
            .err()
            .map(|e| format!("{e:?}"))
            .unwrap_or_default();
    assert!(
        refactor_err.contains("FGT-MSG-002") && refactor_err.contains("[Changed]"),
        "refactor commit must require [Changed] section: {refactor_err}"
    );
}

#[test]
fn forbidden_terms_inside_backticks_and_urls_are_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let backtick_wip = TEMPLATE_CONFORMANT.replace(
        "新增语义槽位解析与双语别名表。",
        "新增语义槽位解析与 `wip` 暂存逻辑验证。",
    );
    let err_backtick = CommitMessageGuard::parse_and_verify(&backtick_wip, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_backtick.contains("FGT-MSG-004"),
        "provisional terms in backticks must NOT bypass the scan: {err_backtick}"
    );

    let url_hack = TEMPLATE_CONFORMANT.replace(
        "新增语义槽位解析与双语别名表。",
        "参考实现见 https://example.com/api/quick-fix 处理。",
    );
    let err_url = CommitMessageGuard::parse_and_verify(&url_hack, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_url.contains("FGT-MSG-004"),
        "forbidden terms in URLs must NOT bypass the scan: {err_url}"
    );
}

#[test]
fn english_first_person_pronouns_and_verb_inflections_are_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let we_message = TEMPLATE_CONFORMANT.replace(
        "门禁按字面量比较区块名，导致模板推荐的双名写法被误判为缺少区块。",
        "We implemented the semantic slot resolver to avoid false rejections.",
    );
    let err_we = CommitMessageGuard::parse_and_verify(&we_message, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_we.contains("FGT-MSG-004") && err_we.contains("first-person"),
        "English first-person pronouns must be rejected: {err_we}"
    );

    let ing_header = TEMPLATE_CONFORMANT.replace(
        "feat(gate): 新增提交信息区块槽位解析与双语别名",
        "feat(gate): adding semantic slot resolver",
    );
    let err_ing = CommitMessageGuard::parse_and_verify(&ing_header, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_ing.contains("FGT-MSG-004") && err_ing.contains("participle"),
        "English -ing verb in header summary must be rejected: {err_ing}"
    );

    let es_header = TEMPLATE_CONFORMANT.replace(
        "feat(gate): 新增提交信息区块槽位解析与双语别名",
        "fix(gate): fixes regression in parser",
    );
    let err_es = CommitMessageGuard::parse_and_verify(&es_header, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_es.contains("FGT-MSG-004"),
        "English third-person singular verb in header summary must be rejected: {err_es}"
    );
}

#[test]
fn invalid_bullet_markers_consecutive_blank_lines_and_fullwidth_brackets_are_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let star_bullet = TEMPLATE_CONFORMANT.replace(
        "- 新增语义槽位解析与双语别名表。",
        "* 新增语义槽位解析与双语别名表。",
    );
    let err_star = CommitMessageGuard::parse_and_verify(&star_bullet, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_star.contains("FGT-MSG-002"),
        "asterisk bullets must be rejected: {err_star}"
    );

    let consecutive_blanks = TEMPLATE_CONFORMANT.replace("\n\n[Why", "\n\n\n[Why");
    let err_blanks = CommitMessageGuard::parse_and_verify(&consecutive_blanks, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_blanks.contains("FGT-MSG-002"),
        "consecutive blank lines must be rejected: {err_blanks}"
    );

    let fullwidth_bracket = TEMPLATE_CONFORMANT.replace("[Why / 动机背景]", "【Why / 动机背景】");
    let err_bracket = CommitMessageGuard::parse_and_verify(&fullwidth_bracket, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_bracket.contains("FGT-MSG-002"),
        "fullwidth brackets must be rejected: {err_bracket}"
    );
}

#[test]
fn timing_extension_misnomer_and_intent_prefix_are_rejected() {
    let policy = TaxisPolicy::workspace_strict();
    let misnomer = TEMPLATE_CONFORMANT.replace("fractal-git", "timing扩展");
    let err_mis = CommitMessageGuard::parse_and_verify(&misnomer, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_mis.contains("FGT-MSG-007"),
        "misnomer timing扩展 must be rejected: {err_mis}"
    );

    let intent = TEMPLATE_CONFORMANT.replace(
        "新增提交信息区块槽位解析与双语别名",
        "希望能支持语义槽位解析",
    );
    let err_intent = CommitMessageGuard::parse_and_verify(&intent, &policy, None)
        .err()
        .map(|e| format!("{e:?}"))
        .unwrap_or_default();
    assert!(
        err_intent.contains("FGT-MSG-004"),
        "disallowed intent prefix 希望能 must be rejected: {err_intent}"
    );
}

#[test]
fn frozen_project_lease_is_rejected_at_storage_boundary() {
    let temp_dir = std::env::temp_dir().join(format!("taxis_frozen_lease_{}", std::process::id()));
    let git_projects = temp_dir.join(".git").join("projects");
    let _ = std::fs::create_dir_all(&git_projects);
    let cache_json = r#"{
      "schema": "project-lease-cache/v1",
      "leases": {
        "fractal-git": {
          "id": "fractal-git",
          "root_path": "fractal-git",
          "status": "Frozen",
          "master_ttl_seconds": 604800,
          "last_activity_unix_seconds": 1000
        }
      }
    }"#;
    std::fs::write(git_projects.join("active_projects.json"), cache_json)
        .expect("write lease cache");

    let mut violations = Vec::new();
    let declared = vec!["fractal-git".to_string()];
    fg_gate::commit_guard::project::check_project_leases_at(&temp_dir, &declared, &mut violations);
    let _ = std::fs::remove_dir_all(&temp_dir);

    assert!(
        violations
            .iter()
            .any(|v| v.contains("FGT-MSG-007") && v.contains("Frozen")),
        "Frozen project lease must be rejected: {violations:?}"
    );
}
