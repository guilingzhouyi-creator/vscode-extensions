//! Module: fg-core — Generalized VCS Governance Policy
//! File Path: crates/fg-core/src/models/policy.rs
//! Architecture Role: Generalized, declarative specification for commit message governance,
//!   decoupled from any specific repository workspace and configurable via presets or TOML.

use serde::{Deserialize, Serialize};

use crate::models::authority::AuthoritySecret;

/// Mode of diff coherence validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffCoherenceMode {
    /// Disabled: no diff-to-message cross-validation.
    Disabled,
    /// Warn: out-of-scope mutations produce warnings.
    Permissive,
    /// Strict: Rust-grade borrow check; out-of-scope mutations or empty commits fail compilation.
    Strict,
}

/// Conflict presentation mode for unmerged paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ConflictPresentationMode {
    /// Agent-Algebraic: Keep working tree files compilable and clean without marker strings,
    /// storing unmerged stage 1/2/3 entries in index/TAXC and emitting structured JSON conflict slices.
    #[default]
    AgentAlgebraic,
    /// Git Compatible: Inject standard Git 2-way conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
    GitCompat,
    /// Diff3 Compatible: Inject standard Git 3-way conflict markers (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`).
    Diff3,
}

impl ConflictPresentationMode {
    /// Returns the canonical CLI spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AgentAlgebraic => "agent-algebraic",
            Self::GitCompat => "git-compat",
            Self::Diff3 => "diff3",
        }
    }

    /// On-disk byte discriminant for TAXC section encoding.
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::AgentAlgebraic => 0,
            Self::GitCompat => 1,
            Self::Diff3 => 2,
        }
    }

    /// Decodes on-disk byte discriminant.
    pub fn from_u8(value: u8) -> Result<Self, u8> {
        match value {
            0 => Ok(Self::AgentAlgebraic),
            1 => Ok(Self::GitCompat),
            2 => Ok(Self::Diff3),
            other => Err(other),
        }
    }

    /// Parses case-insensitive name.
    pub fn parse_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "agent-algebraic" | "agent" | "algebraic" | "clean" => Some(Self::AgentAlgebraic),
            "git-compat" | "git" | "compat" | "markers" => Some(Self::GitCompat),
            "diff3" => Some(Self::Diff3),
            _ => None,
        }
    }
}

impl std::fmt::Display for ConflictPresentationMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Generalized commit message and authority policy for Taxis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaxisPolicy {
    /// Policy identifier/name.
    pub name: String,
    /// Permitted Conventional Commit types (e.g. feat, fix, refactor, perf, etc.).
    pub allowed_types: Vec<String>,
    /// Minimum header length in characters (default: 5).
    pub min_header_chars: usize,
    /// Maximum header length in characters (default: 80).
    pub max_header_chars: usize,
    /// Disallow trailing period on header line (default: true).
    pub disallow_header_period: bool,
    /// Require an empty blank line between header and body (default: true).
    pub require_blank_line: bool,
    /// Minimum substantive body characters for production commits (default: 30).
    pub min_body_chars: usize,
    /// Types that trigger substantive body and structured section checks.
    pub production_types: Vec<String>,
    /// Required structured sections for production commits
    /// (e.g. ["Why", "Changed", "Verification"]).
    pub required_sections: Vec<String>,
    /// Whether a project identifier section is mandatory.
    pub require_project_tag: bool,
    /// Whitelist of allowed project names if project tag is required (empty = allow any).
    pub allowed_projects: Vec<String>,
    /// Forbidden terms or patterns (anti-slang, anti-hype).
    pub forbidden_terms: Vec<String>,
    /// Diff-to-claim semantic coherence verification mode.
    pub diff_coherence: DiffCoherenceMode,
    /// Disallow raw execution telemetry numbers (e.g. "15 tests passed", "0.04s")
    /// in verification section.
    pub qualitative_verification_only: bool,
    /// Enforce exclusive human control on System Trunk & Integration Trunk.
    pub human_controlled_trunks: bool,
    /// Dual-Trunk mode active: official commit count only counts system/integration merges.
    pub dual_trunk_enabled: bool,
    /// Whether promotions to System Trunk strictly require GUI UAC click authorization.
    pub uac_required_for_system_trunk: bool,
    /// Staged promotion lease time-to-live in seconds (default: 3600 = 1 hour).
    pub staged_promotion_ttl_seconds: u64,
    /// Required score delta to supersede an active staged promotion (default: 5.0).
    pub replacement_score_baseline_delta: f64,
    /// Minimum composite score required to enter the staged promotion queue (default: 80.0).
    pub minimum_promotion_score: f64,
    /// Conflict presentation mode for working tree during unmerged states.
    pub conflict_mode: ConflictPresentationMode,
    /// HMAC secret used to verify human authority credentials. Never serialized:
    /// secrets belong to the environment (`TAXIS_AUTHORITY_SECRET`) or to
    /// `core.authoritysecret`, never to a policy file.
    #[serde(skip)]
    pub authority_secret: Option<AuthoritySecret>,
}

impl Default for TaxisPolicy {
    fn default() -> Self {
        Self::workspace_strict()
    }
}

impl TaxisPolicy {
    /// Workspace Strict Policy: Aligned with AGENTS.md, requiring [Project] tag in
    /// ["fractal-git", "auto-refactor", "workspace-timing", "WebGames"], bilingual forbidden
    /// terms from commit-msg-forbidden-terms.json, qualitative verification only, and Human UAC gate.
    pub fn workspace_strict() -> Self {
        Self {
            name: "workspace-strict".into(),
            allowed_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
                "docs".into(),
                "test".into(),
                "chore".into(),
                "style".into(),
            ],
            min_header_chars: 5,
            max_header_chars: 80,
            disallow_header_period: true,
            require_blank_line: true,
            min_body_chars: 30,
            production_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
            ],
            required_sections: vec![
                "Project".into(),
                "Why".into(),
                "Changed".into(),
                "Verification".into(),
            ],
            require_project_tag: true,
            allowed_projects: vec![
                "fractal-git".into(),
                "auto-refactor".into(),
                "workspace-timing".into(),
                "WebGames".into(),
            ],
            forbidden_terms: vec![
                "wip".into(),
                "temp".into(),
                "tmp".into(),
                "quick fix".into(),
                "hack".into(),
                "placeholder".into(),
                "casual commit".into(),
                "update code".into(),
                "fix bug".into(),
                "100% safe".into(),
                "flawless".into(),
                "perfect".into(),
                "never fails".into(),
                "zero bug".into(),
                "exit code 0".into(),
                "all tests passed".into(),
                "all tests green".into(),
                "临时".into(),
                "暂存".into(),
                "暂时".into(),
                "凑合".into(),
                "随便".into(),
                "粗略".into(),
                "先这样".into(),
                "待处理".into(),
                "后续再看".into(),
                "占位".into(),
                "打补丁".into(),
                "草率".into(),
                "绝对".into(),
                "彻底".into(),
                "完美".into(),
                "极致".into(),
                "终极".into(),
                "史无前例".into(),
                "彻底解决".into(),
                "完全消除".into(),
                "永不".into(),
                "绝不".into(),
                "绝无".into(),
            ],
            diff_coherence: DiffCoherenceMode::Strict,
            qualitative_verification_only: true,
            human_controlled_trunks: true,
            dual_trunk_enabled: true,
            uac_required_for_system_trunk: true,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 5.0,
            minimum_promotion_score: 80.0,
            conflict_mode: ConflictPresentationMode::AgentAlgebraic,
            authority_secret: None,
        }
    }

    /// Rust-Grade Strict Policy: Complete compile-time type verification,
    /// qualitative verification only, diff-to-scope coherence checking, and human-only dual trunks.
    pub fn rust_strict() -> Self {
        Self {
            name: "rust-strict".into(),
            allowed_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
                "docs".into(),
                "test".into(),
                "chore".into(),
                "style".into(),
            ],
            min_header_chars: 5,
            max_header_chars: 80,
            disallow_header_period: true,
            require_blank_line: true,
            min_body_chars: 30,
            production_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
            ],
            required_sections: vec!["Why".into(), "Changed".into(), "Verification".into()],
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: vec![
                "wip".into(),
                "temp".into(),
                "tmp".into(),
                "quick fix".into(),
                "hack".into(),
                "placeholder".into(),
                "update code".into(),
                "fix bug".into(),
                "100% safe".into(),
                "flawless".into(),
                "perfect".into(),
                "never fails".into(),
                "zero bug".into(),
                "exit code 0".into(),
                "all tests passed".into(),
                "all tests green".into(),
            ],
            diff_coherence: DiffCoherenceMode::Strict,
            qualitative_verification_only: true,
            human_controlled_trunks: true,
            dual_trunk_enabled: true,
            uac_required_for_system_trunk: true,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 5.0,
            minimum_promotion_score: 80.0,
            conflict_mode: ConflictPresentationMode::AgentAlgebraic,
            authority_secret: None,
        }
    }

    /// Conventional Semantic Policy: Standard Conventional Commits 2.0 without
    /// project or diff bounds.
    pub fn conventional_semantic() -> Self {
        Self {
            name: "conventional-semantic".into(),
            allowed_types: vec![
                "feat".into(),
                "fix".into(),
                "refactor".into(),
                "perf".into(),
                "docs".into(),
                "test".into(),
                "chore".into(),
                "style".into(),
                "build".into(),
                "ci".into(),
                "revert".into(),
            ],
            min_header_chars: 3,
            max_header_chars: 100,
            disallow_header_period: false,
            require_blank_line: true,
            min_body_chars: 10,
            production_types: vec!["feat".into(), "fix".into()],
            required_sections: Vec::new(),
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: vec!["wip".into(), "temp".into()],
            diff_coherence: DiffCoherenceMode::Permissive,
            qualitative_verification_only: false,
            human_controlled_trunks: true,
            dual_trunk_enabled: false,
            uac_required_for_system_trunk: true,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 5.0,
            minimum_promotion_score: 70.0,
            conflict_mode: ConflictPresentationMode::GitCompat,
            authority_secret: None,
        }
    }

    /// Native Git Policy: fully permissive fallback, accepting any commit message.
    pub fn git_native() -> Self {
        Self {
            name: "git-native".into(),
            allowed_types: Vec::new(),
            min_header_chars: 1,
            max_header_chars: 1000,
            disallow_header_period: false,
            require_blank_line: false,
            min_body_chars: 0,
            production_types: Vec::new(),
            required_sections: Vec::new(),
            require_project_tag: false,
            allowed_projects: Vec::new(),
            forbidden_terms: Vec::new(),
            diff_coherence: DiffCoherenceMode::Disabled,
            qualitative_verification_only: false,
            human_controlled_trunks: false,
            dual_trunk_enabled: false,
            uac_required_for_system_trunk: false,
            staged_promotion_ttl_seconds: 3600,
            replacement_score_baseline_delta: 0.0,
            minimum_promotion_score: 0.0,
            conflict_mode: ConflictPresentationMode::GitCompat,
            authority_secret: None,
        }
    }
}
