//! Module: fg-core — Product Edition & Capability Declaration
//! File Path: crates/fg-core/src/constants/edition.rs
//! Architecture Role: Single source of truth for which capability tier this binary belongs to, so
//!   every layer can answer "may I do this?" without guessing from a build flag or a help string.
//! Dependencies & Triggers: Read by `taxis version`, the CLI help renderer, and every command that
//!   needs to refuse an unavailable capability (network transports today).
//! Responsibilities: Declare the edition, enumerate capabilities, and expose one predicate per
//!   capability that a command can gate on.
//! Exit Semantics & Design Rationale:
//!   - The edition describes *this binary*, not the repository. A repository created by an
//!     engineering build must remain openable by a general build and vice versa, so recording the
//!     edition inside the repository would bind the data to the tool that happened to create it.
//!   - This is deliberately not the same axis as `LayoutMode`. `LayoutMode` says where the bytes
//!     physically live (a directory inside the workspace versus a store-backed location); edition
//!     says which capabilities the product offers. Merging them would make "storage form" and
//!     "product maturity" inseparable, and promoting to a general edition would then require a
//!     repository migration that has nothing to do with storage.
//!   - Capabilities are enumerated rather than inferred from the edition, so that promoting one
//!     feature does not require promoting all of them. A general edition can ship network support
//!     while multi-repository coordination is still absent, and each is independently gated.
//!
//! ### Domain Governance Rules (SSOT):
//! - `FGT-COR-001`: Core data model and error contract guard

use serde::{Deserialize, Serialize};

/// Capability tier of the running binary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    /// Engineering development edition: local repository management only.
    ///
    /// Network transports and multi-repository coordination are deliberately not wired, and every
    /// command that would need one refuses with an explanation instead of pretending to succeed.
    Engineering,
    /// General availability edition, which enables the capabilities listed in [`Capabilities`].
    General,
}

impl Edition {
    /// The edition this binary was built as.
    ///
    /// Hardcoded rather than feature-detected: a build either contains the network transport or it
    /// does not, and a runtime probe that silently answered "unavailable" would make a broken
    /// general build indistinguishable from an honest engineering build.
    pub const CURRENT: Self = Self::Engineering;

    /// Stable lowercase identifier used in CLI output and JSON.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Engineering => "engineering",
            Self::General => "general",
        }
    }

    /// Parses an edition identifier, returning `None` for anything unrecognised.
    pub fn parse_str(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "engineering" => Some(Self::Engineering),
            "general" => Some(Self::General),
            _ => None,
        }
    }

    /// Capabilities this edition ships.
    pub fn capabilities(self) -> Capabilities {
        match self {
            Self::Engineering => Capabilities {
                network_transport: false,
                multi_repo_coordination: false,
                local_git_parity: true,
            },
            Self::General => Capabilities {
                network_transport: true,
                multi_repo_coordination: true,
                local_git_parity: true,
            },
        }
    }

    /// One-line human description shown by `taxis version`.
    pub fn description(self) -> &'static str {
        match self {
            Self::Engineering => {
                "engineering edition — local repository management only, network disabled"
            }
            Self::General => "general edition — full capability set",
        }
    }
}

/// Individual capability switches, so one feature can be promoted without promoting all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Capabilities {
    /// Reaching a remote over a real network transport (`https://`, `ssh://`, `git://`).
    pub network_transport: bool,
    /// Coordinating more than one repository at once (submodules, cross-repo promotion).
    pub multi_repo_coordination: bool,
    /// Local repository management at Git parity.
    pub local_git_parity: bool,
}

impl Capabilities {
    /// Capabilities of the running binary.
    pub fn current() -> Self {
        Edition::CURRENT.capabilities()
    }

    /// Whether a named capability is enabled.
    ///
    /// Returns `false` for an unknown name: a capability that has not been declared cannot have been
    /// implemented, and a typo must not silently unlock a path that was never built.
    pub fn allows(self, capability: &str) -> bool {
        match capability.trim().to_ascii_lowercase().as_str() {
            "network_transport" | "network" => self.network_transport,
            "multi_repo_coordination" | "multi_repo" => self.multi_repo_coordination,
            "local_git_parity" | "local" => self.local_git_parity,
            _ => false,
        }
    }
}

/// Name of the network-transport capability, for call sites that must refuse without it.
pub const CAPABILITY_NETWORK: &str = "network_transport";

/// Name of the multi-repository coordination capability.
pub const CAPABILITY_MULTI_REPO: &str = "multi_repo_coordination";

/// Extension points a general edition is expected to fill.
///
/// Recorded as data rather than prose so the seam cannot silently rot: a future implementation that
/// starts delivering one of these capabilities has to change this table, and the change is visible in
/// review. Nothing here has an implementation in the engineering edition, and naming an entry is not
/// a claim that it works — it is a claim that the *boundary* is deliberate.
pub const PLANNED_CAPABILITIES: &[PlannedCapability] = &[
    PlannedCapability {
        name: CAPABILITY_NETWORK,
        landing_point: "TransportResolver::resolve in src/bin/taxis_cmd/remote.rs",
        note:
            "Add a scheme arm returning a RemoteTransport implementation; the command layer must \
               not learn about schemes.",
    },
    PlannedCapability {
        name: CAPABILITY_MULTI_REPO,
        landing_point: "MultiRepoCoordinator (not yet defined)",
        note: "Submodule and cross-repository promotion both need one coordinator; adding them \
               separately would produce two notions of 'the other repository'.",
    },
];

/// One capability that a future edition is expected to provide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlannedCapability {
    /// Capability identifier, matching [`Capabilities::allows`].
    pub name: &'static str,
    /// The single place a real implementation is expected to be plugged in.
    pub landing_point: &'static str,
    /// What the implementation has to preserve for the surrounding architecture to keep working.
    pub note: &'static str,
}

impl PlannedCapability {
    /// Looks up a planned capability by name.
    pub fn find(name: &str) -> Option<&'static Self> {
        PLANNED_CAPABILITIES
            .iter()
            .find(|planned| planned.name == name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engineering_edition_reports_network_disabled() {
        let capabilities = Edition::Engineering.capabilities();
        assert!(!capabilities.network_transport);
        assert!(!capabilities.multi_repo_coordination);
        assert!(
            capabilities.local_git_parity,
            "the engineering edition exists to deliver local parity; disabling it would leave no purpose"
        );
    }

    #[test]
    fn general_edition_enables_network() {
        assert!(Edition::General.capabilities().network_transport);
    }

    #[test]
    fn edition_identifiers_round_trip() {
        for edition in [Edition::Engineering, Edition::General] {
            assert_eq!(Edition::parse_str(edition.as_str()), Some(edition));
        }
    }

    #[test]
    fn unknown_capability_is_denied_rather_than_defaulted() {
        let capabilities = Edition::General.capabilities();
        assert!(
            !capabilities.allows("teleportation"),
            "an undeclared capability must be denied even on the widest edition"
        );
    }

    #[test]
    fn capability_aliases_resolve_to_the_same_switch() {
        let capabilities = Edition::Engineering.capabilities();
        assert_eq!(
            capabilities.allows("network"),
            capabilities.allows("network_transport")
        );
        assert_eq!(
            capabilities.allows("multi_repo"),
            capabilities.allows("multi_repo_coordination")
        );
    }

    #[test]
    fn every_disabled_capability_has_a_recorded_landing_point() {
        // The engineering edition's whole bargain is "not yet, but the seam is ready". A disabled
        // capability with no recorded landing point is a promise nobody wrote down, and the next
        // implementer would have to rediscover where it belongs.
        let capabilities = Edition::Engineering.capabilities();
        for (name, enabled) in [
            (CAPABILITY_NETWORK, capabilities.network_transport),
            (CAPABILITY_MULTI_REPO, capabilities.multi_repo_coordination),
        ] {
            if enabled {
                continue;
            }
            assert!(
                PlannedCapability::find(name).is_some(),
                "disabled capability '{name}' must name where it will be implemented"
            );
        }
    }

    #[test]
    fn planned_landing_points_are_not_empty() {
        for planned in PLANNED_CAPABILITIES {
            assert!(
                !planned.landing_point.trim().is_empty(),
                "capability '{}' must say where it lands",
                planned.name
            );
            assert!(
                !planned.note.trim().is_empty(),
                "capability '{}' must state what the implementation has to preserve",
                planned.name
            );
        }
    }
}
