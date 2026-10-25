//! Module: Native Acceleration Kernel — Secrets & Credential Detection
//! Crate: ops-pattern
//! Architecture Role: High-throughput pattern search and Shannon entropy analysis
//!   for credential leaks and high-entropy sensitive tokens.
//! Exit Semantics & Design Rationale: Pure, allocation-minimized Rust scanner
//!   with zero panic guarantees and deterministic SIMD-friendly byte loops.

/// Finding emitted when a credential or high-entropy string is detected.
#[derive(Debug, Clone, PartialEq)]
pub struct SecretFinding {
    pub rule: String,
    pub kind: String,
    pub line: u32,
    pub column: u32,
    pub message: String,
    pub preview: String,
    pub entropy: f64,
}

/// Configuration options controlling secrets scanning behavior.
#[derive(Debug, Clone)]
pub struct SecretScanOptions {
    pub scan_entropy: bool,
    pub min_entropy_len: usize,
    pub entropy_threshold: f64,
    pub max_findings: usize,
}

impl Default for SecretScanOptions {
    fn default() -> Self {
        Self {
            scan_entropy: false,
            min_entropy_len: 24,
            entropy_threshold: 4.2,
            max_findings: 50,
        }
    }
}

/// Calculate Shannon entropy for a slice of bytes in bits per character.
#[inline]
pub fn calculate_shannon_entropy(token: &[u8]) -> f64 {
    if token.is_empty() {
        return 0.0;
    }
    let mut freqs = [0u32; 256];
    for &b in token {
        freqs[b as usize] += 1;
    }
    let len_f = token.len() as f64;
    let mut entropy = 0.0;
    for &count in &freqs {
        if count > 0 {
            let p = (count as f64) / len_f;
            entropy -= p * p.log2();
        }
    }
    entropy
}

#[inline(always)]
fn is_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Scan a line for precise known credential patterns.
fn scan_line_credentials(
    line: &str,
    line_num: u32,
    findings: &mut Vec<SecretFinding>,
    max_findings: usize,
) {
    if findings.len() >= max_findings {
        return;
    }

    let bytes = line.as_bytes();

    // 1. Private key header marker: BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY
    let key_prefixes: [&str; 6] = [
        concat!("BEGIN RSA ", "PRIVATE KEY"),
        concat!("BEGIN EC ", "PRIVATE KEY"),
        concat!("BEGIN OPENSSH ", "PRIVATE KEY"),
        concat!("BEGIN DSA ", "PRIVATE KEY"),
        concat!("BEGIN PGP ", "PRIVATE KEY"),
        concat!("BEGIN ", "PRIVATE KEY"),
    ];
    for &prefix in &key_prefixes {
        if let Some(pos) = line.find(prefix) {
            findings.push(SecretFinding {
                rule: "secret-detected".to_string(),
                kind: "private-key".to_string(),
                line: line_num,
                column: (pos + 1) as u32,
                message: "Possible secret detected (pattern: private-key)".to_string(),
                preview: prefix.to_string(),
                entropy: 0.0,
            });
            return;
        }
    }

    // 2. GitHub Token: "ghp_" followed by 20+ alnum
    if let Some(pos) = line.find("ghp_") {
        let tail = &bytes[pos + 4..];
        let mut count = 0;
        while count < tail.len() && tail[count].is_ascii_alphanumeric() {
            count += 1;
        }
        if count >= 20 {
            findings.push(SecretFinding {
                rule: "secret-detected".to_string(),
                kind: "github-token".to_string(),
                line: line_num,
                column: (pos + 1) as u32,
                message: "Possible secret detected (pattern: github-token)".to_string(),
                preview: line[pos..pos + 4 + count.min(30)].to_string(),
                entropy: 0.0,
            });
            return;
        }
    }

    // 3. GitHub PAT: "github_pat_" followed by 20+ alnum/underscore
    if let Some(pos) = line.find("github_pat_") {
        let tail = &bytes[pos + 11..];
        let mut count = 0;
        while count < tail.len() && (tail[count].is_ascii_alphanumeric() || tail[count] == b'_') {
            count += 1;
        }
        if count >= 20 {
            findings.push(SecretFinding {
                rule: "secret-detected".to_string(),
                kind: "github-pat".to_string(),
                line: line_num,
                column: (pos + 1) as u32,
                message: "Possible secret detected (pattern: github-pat)".to_string(),
                preview: line[pos..pos + 11 + count.min(30)].to_string(),
                entropy: 0.0,
            });
            return;
        }
    }

    // 4. OpenAI style key: "sk-" followed by 20+ alnum
    if let Some(pos) = line.find("sk-") {
        let tail = &bytes[pos + 3..];
        let mut count = 0;
        while count < tail.len() && tail[count].is_ascii_alphanumeric() {
            count += 1;
        }
        if count >= 20 {
            findings.push(SecretFinding {
                rule: "secret-detected".to_string(),
                kind: "openai-style-key".to_string(),
                line: line_num,
                column: (pos + 1) as u32,
                message: "Possible secret detected (pattern: openai-style-key)".to_string(),
                preview: line[pos..pos + 3 + count.min(30)].to_string(),
                entropy: 0.0,
            });
            return;
        }
    }

    // 5. AWS Access Key: "AKIA" followed by 16 uppercase alphanumeric characters
    if let Some(pos) = line.find("AKIA") {
        if pos + 20 <= line.len() {
            let tail = &bytes[pos + 4..pos + 20];
            let is_aws = tail
                .iter()
                .all(|&b| b.is_ascii_uppercase() || b.is_ascii_digit());
            if is_aws {
                findings.push(SecretFinding {
                    rule: "secret-detected".to_string(),
                    kind: "aws-access-key".to_string(),
                    line: line_num,
                    column: (pos + 1) as u32,
                    message: "Possible secret detected (pattern: aws-access-key)".to_string(),
                    preview: line[pos..pos + 20].to_string(),
                    entropy: 0.0,
                });
            }
        }
    }
}

/// Scan a line for high-entropy alphanumeric strings.
fn scan_line_entropy(
    line: &str,
    line_num: u32,
    min_len: usize,
    threshold: f64,
    findings: &mut Vec<SecretFinding>,
    max_findings: usize,
) {
    if findings.len() >= max_findings {
        return;
    }

    let bytes = line.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if is_token_char(bytes[i]) {
            let start = i;
            while i < bytes.len() && is_token_char(bytes[i]) {
                i += 1;
            }
            let token_bytes = &bytes[start..i];
            if token_bytes.len() >= min_len {
                let ent = calculate_shannon_entropy(token_bytes);
                if ent >= threshold {
                    let preview =
                        String::from_utf8_lossy(&token_bytes[..token_bytes.len().min(30)])
                            .to_string();
                    findings.push(SecretFinding {
                        rule: "high-entropy-token".to_string(),
                        kind: "high-entropy".to_string(),
                        line: line_num,
                        column: (start + 1) as u32,
                        message: format!(
                            "High-entropy token detected ({:.2} bits/char, threshold {:.2})",
                            ent, threshold
                        ),
                        preview,
                        entropy: (ent * 100.0).round() / 100.0,
                    });
                    if findings.len() >= max_findings {
                        return;
                    }
                }
            }
        } else {
            i += 1;
        }
    }
}

/// Scan full source text for hardcoded credentials and high-entropy secrets.
///
/// # Arguments
/// * `source_text` - Source text to inspect line by line.
/// * `options` - Scanner configuration.
///
/// # Returns
/// Vector of detected SecretFinding records.
pub fn scan_secrets_native(source_text: &str, options: &SecretScanOptions) -> Vec<SecretFinding> {
    let mut findings = Vec::new();
    if source_text.is_empty() {
        return findings;
    }

    for (line_idx, line) in source_text.lines().enumerate() {
        let line_num = (line_idx + 1) as u32;

        let start_count = findings.len();
        scan_line_credentials(line, line_num, &mut findings, options.max_findings);

        // If credentials matched on this line, don't duplicate with entropy on the same line
        if options.scan_entropy && findings.len() == start_count {
            scan_line_entropy(
                line,
                line_num,
                options.min_entropy_len,
                options.entropy_threshold,
                &mut findings,
                options.max_findings,
            );
        }

        if findings.len() >= options.max_findings {
            break;
        }
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shannon_entropy_calculation() {
        // Uniform distribution: 4 different chars, entropy = log2(4) = 2.0
        let uniform = b"ABCD";
        let ent = calculate_shannon_entropy(uniform);
        assert!((ent - 2.0).abs() < 1e-6);

        // Homogeneous: all 'A', entropy = 0.0
        let zero = b"AAAAAA";
        assert_eq!(calculate_shannon_entropy(zero), 0.0);
    }

    #[test]
    fn test_scan_github_token() {
        let code = concat!(
            "const token = \"",
            "ghp_",
            "1234567890abcdefghijklmnopqrstuvwxyz\";\n"
        );
        let opts = SecretScanOptions::default();
        let findings = scan_secrets_native(code, &opts);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].rule, "secret-detected");
        assert_eq!(findings[0].line, 1);
    }

    #[test]
    fn test_scan_private_key() {
        let code = concat!("-----BEGIN RSA ", "PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n");
        let opts = SecretScanOptions::default();
        let findings = scan_secrets_native(code, &opts);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].rule, "secret-detected");
    }

    #[test]
    fn test_scan_high_entropy() {
        let code = "const key = \"4fA9zB8xK2qL1wP0mN7vR5tY3uI6o\";\n";
        let opts = SecretScanOptions {
            scan_entropy: true,
            min_entropy_len: 20,
            entropy_threshold: 4.0,
            max_findings: 10,
        };
        let findings = scan_secrets_native(code, &opts);
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].rule, "high-entropy-token");
        assert!(findings[0].entropy >= 4.0);
    }
}
