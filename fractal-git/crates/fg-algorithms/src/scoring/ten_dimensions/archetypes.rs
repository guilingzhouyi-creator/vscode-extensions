//! Module: fg-algorithms — Project Archetypes & Rule-to-Dimension Routing
//! File Path: crates/fg-algorithms/src/scoring/ten_dimensions/archetypes.rs
//! Architecture Role: Mass-invariant archetype weight tuning (`ArchetypeWeightTuner`) and SSOT
//!   longest-prefix mapping from static rule IDs onto the ten `QualityDimension` axes.
//! Dependencies & Triggers: Extends `taxonomy`; consumed by `ten_dimensions::deductions` & `mod.rs`.
//! Responsibilities: Parse archetype labels, normalize weights preserving unit mass, and route rules.
//! Exit Semantics & Design Rationale: Static slices avoid heap maps and keep rule lookup `O(N)`
//!   across tiny compile-time arrays with zero runtime allocations.

use super::taxonomy::{QualityDimension, QualityWeightVector};

/// Project archetype profiles mirroring `ArchetypeWeightTuner`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectArchetype {
    DefaultBalanced,
    SystemsRuntime,
    Game,
    Library,
    Stdlib,
    Web,
    Cli,
    Demo,
    Frontend,
    Backend,
    Composite,
}

impl ProjectArchetype {
    /// Parses an archetype identifier string (`systems_runtime`, `library`, etc.).
    #[must_use]
    pub fn from_label(label: &str) -> Self {
        match label.trim() {
            "systems_runtime" => Self::SystemsRuntime,
            "game" => Self::Game,
            "library" => Self::Library,
            "stdlib" => Self::Stdlib,
            "web" => Self::Web,
            "cli" => Self::Cli,
            "demo" => Self::Demo,
            "frontend" => Self::Frontend,
            "backend" => Self::Backend,
            "composite" => Self::Composite,
            _ => Self::DefaultBalanced,
        }
    }

    const fn multipliers(self) -> [f64; 10] {
        match self {
            Self::DefaultBalanced => [1.0; 10],
            Self::SystemsRuntime => [1.4, 1.2, 1.5, 1.8, 1.0, 1.0, 1.0, 0.8, 0.9, 1.5],
            Self::Game => [1.3, 1.4, 0.9, 1.9, 1.0, 1.1, 1.2, 0.6, 1.0, 1.2],
            Self::Library => [1.3, 1.1, 1.2, 1.0, 1.6, 1.3, 1.4, 1.5, 1.2, 1.0],
            Self::Stdlib => [1.4, 1.2, 1.3, 1.1, 1.7, 1.3, 1.5, 1.6, 1.2, 1.1],
            Self::Web => [1.2, 1.0, 1.6, 1.0, 1.2, 1.4, 1.3, 0.9, 1.1, 1.2],
            Self::Cli => [1.1, 1.4, 1.2, 0.7, 1.2, 1.1, 1.6, 1.0, 1.0, 1.1],
            Self::Demo => [0.8, 0.9, 0.8, 0.6, 1.2, 1.3, 1.0, 1.4, 0.9, 0.8],
            Self::Frontend => [0.6, 1.3, 0.5, 0.7, 1.5, 1.0, 1.1, 1.4, 1.4, 1.6],
            Self::Backend => [1.6, 1.3, 1.4, 1.8, 0.8, 1.0, 1.6, 0.6, 0.7, 1.0],
            Self::Composite => [1.2, 1.1, 1.2, 1.2, 1.0, 1.0, 1.1, 1.0, 1.0, 1.2],
        }
    }
}

/// Tunes quality dimension weights with mass invariance matching `ArchetypeWeightTuner`.
#[must_use]
pub fn tune_archetype_weights(
    archetype: ProjectArchetype,
    base: QualityWeightVector,
) -> QualityWeightVector {
    if archetype == ProjectArchetype::DefaultBalanced {
        return base;
    }
    let round6 = |v: f64| (v * 1_000_000.0).round() / 1_000_000.0;
    let muls = archetype.multipliers();
    let (mut base_mass, mut unnorm_mass, mut unnorm) = (0.0, 0.0, [0.0_f64; 10]);
    for idx in 0..10 {
        base_mass += base.values[idx];
        unnorm[idx] = base.values[idx] * muls[idx];
        unnorm_mass += unnorm[idx];
    }
    if unnorm_mass <= 0.0 {
        return base;
    }
    let scale = base_mass / unnorm_mass;
    let (mut rounded, mut rounded_mass) = ([0.0_f64; 10], 0.0);
    for idx in 0..10 {
        rounded[idx] = round6(unnorm[idx] * scale);
        rounded_mass += rounded[idx];
    }
    if rounded_mass <= 0.0 {
        return base;
    }
    let corr = base_mass / rounded_mass;
    let mut out = [0.0_f64; 10];
    for idx in 0..10 {
        out[idx] = round6(rounded[idx] * corr);
    }
    QualityWeightVector { values: out }
}

const EXACT_RULE_DIM: &[(&str, QualityDimension)] = &[
    ("HC-SECRET", QualityDimension::CodeSecurity),
    ("secret-detected", QualityDimension::CodeSecurity),
    ("high-entropy-token", QualityDimension::CodeSecurity),
    ("import-cycle", QualityDimension::ArchitectureConsistency),
    (
        "disallowed-import",
        QualityDimension::ArchitectureConsistency,
    ),
    (
        "clean-layer-violation",
        QualityDimension::ArchitectureConsistency,
    ),
    (
        "loop-transient-allocation",
        QualityDimension::PerformanceEfficiency,
    ),
    (
        "expensive-loop-operation",
        QualityDimension::PerformanceEfficiency,
    ),
    ("GOV-GAM-001", QualityDimension::Maintainability),
    ("high-complexity", QualityDimension::Maintainability),
    ("large-file", QualityDimension::Maintainability),
    ("HYG-CLN-001", QualityDimension::Duplication),
    ("duplicate-literal", QualityDimension::Duplication),
    ("nested-constant", QualityDimension::Duplication),
    ("HC-MAGIC-NUM", QualityDimension::Duplication),
    ("HC-UI-STRING", QualityDimension::Duplication),
    ("unused-export", QualityDimension::SemanticPurity),
    ("unused-module", QualityDimension::SemanticPurity),
];

const PREFIX_RULE_DIM: &[(&str, QualityDimension)] = &[
    ("SEC", QualityDimension::CodeSecurity),
    ("FGT-SAF", QualityDimension::CodeSecurity),
    ("GUARD-DESTR", QualityDimension::CodeSecurity),
    ("ARCH", QualityDimension::ArchitectureConsistency),
    ("DAT-LAY", QualityDimension::ArchitectureConsistency),
    ("DAT-DEF", QualityDimension::ArchitectureConsistency),
    ("DEP-LAZ", QualityDimension::ArchitectureConsistency),
    ("DEP-RES", QualityDimension::ArchitectureConsistency),
    ("DEP-INV", QualityDimension::ArchitectureConsistency),
    ("FGT-DEP", QualityDimension::ArchitectureConsistency),
    ("FGT-BRG", QualityDimension::ArchitectureConsistency),
    ("FGT-COR", QualityDimension::ArchitectureConsistency),
    ("FGT-TOP", QualityDimension::ArchitectureConsistency),
    ("PRF", QualityDimension::PerformanceEfficiency),
    ("FGT-PRF", QualityDimension::PerformanceEfficiency),
    ("FGT-LCK", QualityDimension::PerformanceEfficiency),
    ("FGT-ALG", QualityDimension::PerformanceEfficiency),
    ("ADV-PRF", QualityDimension::PerformanceEfficiency),
    ("CMP", QualityDimension::PerformanceEfficiency),
    ("CPX-TIME", QualityDimension::PerformanceEfficiency),
    ("CPX-SPACE", QualityDimension::PerformanceEfficiency),
    ("CPX-AMP", QualityDimension::PerformanceEfficiency),
    ("DAT", QualityDimension::PerformanceEfficiency),
    ("CPX", QualityDimension::Maintainability),
    ("VOL-", QualityDimension::Maintainability),
    ("ERR", QualityDimension::Maintainability),
    ("STDLIB-PANIC", QualityDimension::Maintainability),
    ("STDLIB-RECURSION", QualityDimension::Maintainability),
    ("SIM-TRN", QualityDimension::Maintainability),
    ("SIM-BOOL", QualityDimension::Maintainability),
    ("SIM-ELSE", QualityDimension::Maintainability),
    ("SIM-GUARD", QualityDimension::Maintainability),
    ("FGT-ERR", QualityDimension::Maintainability),
    ("CMT", QualityDimension::CommentQuality),
    ("DOC", QualityDimension::CommentQuality),
    ("VSC-I18N", QualityDimension::CommentQuality),
    ("CONST", QualityDimension::Duplication),
    ("GOV-TYP", QualityDimension::SemanticPurity),
    ("NUM", QualityDimension::SemanticPurity),
    ("HYG-DED", QualityDimension::SemanticPurity),
    ("HYG-WRAP", QualityDimension::SemanticPurity),
    ("TSM", QualityDimension::Modernity),
    ("RSM", QualityDimension::Modernity),
    ("PYM", QualityDimension::Modernity),
    ("MOD", QualityDimension::Modernity),
    ("TST", QualityDimension::Modernity),
    ("GDM", QualityDimension::Modernity),
    ("GOM", QualityDimension::Modernity),
];

/// Maps a rule identifier to its primary owning quality dimension via longest-prefix SSOT.
#[must_use]
pub fn family_dimension_of(rule_id: &str) -> Option<QualityDimension> {
    if rule_id.is_empty() {
        return None;
    }
    if let Some((_, dim)) = EXACT_RULE_DIM.iter().find(|(id, _)| *id == rule_id) {
        return Some(*dim);
    }
    if let Some((_, dim)) = PREFIX_RULE_DIM
        .iter()
        .find(|(pfx, _)| rule_id.starts_with(pfx))
    {
        return Some(*dim);
    }
    Some(QualityDimension::Standardization)
}
