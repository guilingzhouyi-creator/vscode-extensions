use super::*;

fn c_family_config() -> MaskConfig {
    MaskConfig {
        line_comment: "//".to_string(),
        block_comment: Some(("/*".to_string(), "*/".to_string())),
        quote_chars: "'\"`".to_string(),
        multiline_templates: true,
        regex_literals: true,
        html_comment: true,
    }
}

#[test]
fn test_mask_comments_and_strings() {
    let code = "const a = 'hello'; // comment\nconst b = 10; /* block */ const c = 20;";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(res.lines, 2);
    assert_eq!(res.non_blank_lines, 2);
    assert_eq!(res.masked[0], "const a =        ;           ");
    assert_eq!(res.masked[1], "const b = 10;             const c = 20;");
}

#[test]
fn test_multiline_block_comment() {
    let code = "/* start\n middle\n end */ code";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(res.lines, 3);
    assert_eq!(res.masked[0], "        ");
    assert_eq!(res.masked[1], "       ");
    assert_eq!(res.masked[2], "        code");
}

#[test]
fn test_regex_masking() {
    let code = "const re = /abc[0-9]\\//gi; const div = a / b / c;";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(
        res.masked[0],
        "const re =               ; const div = a / b / c;"
    );
}

#[test]
fn test_chinese_and_unicode_char_count() {
    let code = "const msg = '你好世界'; // 这是注释";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(
        res.raw[0].encode_utf16().count(),
        res.masked[0].encode_utf16().count()
    );
    assert!(res.masked[0].starts_with("const msg = "));
}

#[test]
fn test_empty_and_whitespace() {
    let res = mask_source_code("", &c_family_config());
    assert_eq!(res.lines, 1);
    assert_eq!(res.non_blank_lines, 0);

    let res_ws = mask_source_code("   \n\t\n", &c_family_config());
    assert_eq!(res_ws.lines, 3);
    assert_eq!(res_ws.non_blank_lines, 0);
}

#[test]
fn test_python_hash_and_docstrings() {
    let py_config = MaskConfig {
        line_comment: "#".to_string(),
        block_comment: Some(("\"\"\"".to_string(), "\"\"\"".to_string())),
        quote_chars: "'\"".to_string(),
        multiline_templates: false,
        regex_literals: false,
        html_comment: false,
    };
    let code = "# Header\ndef foo():\n    \"\"\"Docstring\n    line 2\"\"\"\n    return 42 # end";
    let res = mask_source_code(code, &py_config);
    assert_eq!(res.lines, 5);
    assert!(res.masked[0].trim().is_empty());
    assert!(res.masked[4].ends_with("      "));
}

#[test]
fn test_powershell_block_comments() {
    let ps_config = MaskConfig {
        line_comment: "#".to_string(),
        block_comment: Some(("<#".to_string(), "#>".to_string())),
        quote_chars: "'\"".to_string(),
        multiline_templates: false,
        regex_literals: false,
        html_comment: false,
    };
    let code = "<# Block comment\n multi-line #>\nWrite-Host 'Hello'";
    let res = mask_source_code(code, &ps_config);
    assert_eq!(res.lines, 3);
    assert!(res.masked[0].trim().is_empty());
    assert!(res.masked[1].trim().is_empty());
    assert!(res.masked[2].starts_with("Write-Host "));
}

#[test]
fn test_escaped_quotes_inside_strings() {
    let code = "const s = \"escaped \\\"quote\\\" inside\"; const next = 10;";
    let res = mask_source_code(code, &c_family_config());
    assert!(res.masked[0].ends_with("const next = 10;"));
    assert!(res.masked[0].starts_with("const s = "));
}

#[test]
fn test_multiline_template_literals() {
    let code = "const t = `line 1\nline 2 ${val}\nline 3`; const done = true;";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(res.lines, 3);
    assert!(res.masked[2].ends_with("const done = true;"));
}

#[test]
fn test_unclosed_block_comment() {
    let code = "const a = 1;\n/* unclosed comment start\nline 3";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(res.lines, 3);
    assert!(res.masked[1].trim().is_empty());
    assert!(res.masked[2].trim().is_empty());
}

#[test]
fn test_mixed_single_and_double_quotes() {
    let code = "const msg1 = \"double 'with' single\"; const msg2 = 'single \"with\" double';";
    let res = mask_source_code(code, &c_family_config());
    assert_eq!(res.lines, 1);
    assert!(res.masked[0].contains("const msg1 = "));
    assert!(res.masked[0].contains("; const msg2 = "));
}

fn rust_config() -> MaskConfig {
    MaskConfig {
        line_comment: "//".to_string(),
        block_comment: Some(("/*".to_string(), "*/".to_string())),
        quote_chars: "\"".to_string(),
        multiline_templates: false,
        regex_literals: false,
        html_comment: false,
    }
}

#[test]
fn test_rust_raw_string_literals_single_line() {
    let code = concat!(
        "let s = r#\"hello try!()\"#; let next = 10;\n",
        "let s2 = r\"hello\"; let s3 = r##\"nested \"quote\" and \"# hash\"##;"
    );
    let res = mask_source_code(code, &rust_config());
    assert_eq!(res.lines, 2);
    assert_eq!(res.masked[0], "let s =                  ; let next = 10;");
    assert_eq!(
        res.masked[1],
        "let s2 =         ; let s3 =                                  ;"
    );
}

#[test]
fn test_rust_raw_string_multiline() {
    let code = "let s = r#\"start\nmiddle line with \"nested\"\nend\"#; let done = true;";
    let res = mask_source_code(code, &rust_config());
    assert_eq!(res.lines, 3);
    assert_eq!(res.masked[0], "let s =         ");
    assert_eq!(res.masked[1], "                         ");
    assert_eq!(res.masked[2], "     ; let done = true;");
}

#[test]
fn test_rust_raw_string_lifetimes_and_raw_idents() {
    let code = "fn foo<'a>(r#type: &'a str) -> &str { r#\"try!()\"# }";
    let res = mask_source_code(code, &rust_config());
    assert_eq!(
        res.masked[0],
        "fn foo<'a>(r#type: &'a str) -> &str {             }"
    );
}

#[test]
fn test_rust_byte_raw_string() {
    let code = "let b = br#\"hello\"#; let c = cr\"cstr\";";
    let res = mask_source_code(code, &rust_config());
    assert_eq!(res.masked[0], "let b =            ; let c =         ;");
}

#[test]
fn test_mask_source_code_compact_equivalence() {
    let code = "const msg = \"hello\";\n// comment line\nconst x = 42; /* block */\n";
    let config = c_family_config();
    let res = mask_source_code(code, &config);
    let compact = mask_source_code_compact(code, &config);
    assert_eq!(compact, res.masked.join("\n"));
}

#[test]
fn test_html_comment_masking() {
    let code = "const a = 1; <!-- METRICS:BEGIN -->\ninner <!-- comment\nend --> const b = 2;";
    let config = c_family_config();
    let res = mask_source_code(code, &config);
    assert_eq!(res.lines, 3);
    assert_eq!(res.masked[0], "const a = 1;                       ");
    assert_eq!(res.masked[1], "inner             ");
    assert_eq!(res.masked[2], "        const b = 2;");
}
