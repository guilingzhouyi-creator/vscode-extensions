//! Module: fg-topology — Fractal Audit Tree Unit Tests
//! File Path: crates/fg-topology/src/audit_tree/unit_tests.rs
//! Architecture Role: Validates worktree-free Merkle audit commit materialization, upward 4-tier
//!   hierarchy rollups, artifact readback, and fail-closed non-audit ref rejection.

#[cfg(test)]
mod tests {
    use super::super::*;
    use fg_core::models::{compute_object_oid, raw_object};
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryOdb {
        objects: Mutex<HashMap<Oid, Vec<u8>>>,
    }

    impl OdbStore for MemoryOdb {
        fn read_object(&self, oid: &Oid) -> FractalResult<Vec<u8>> {
            self.objects
                .lock()
                .map_err(|_| FractalError::ObjectCodec("memory odb mutex poisoned".into()))?
                .get(oid)
                .cloned()
                .ok_or_else(|| FractalError::ObjectCodec(format!("missing object {oid}")))
        }

        fn write_object(&self, object_type: &str, payload: &[u8]) -> FractalResult<Oid> {
            let kind = match object_type {
                "blob" => ObjectKind::Blob,
                "tree" => ObjectKind::Tree,
                "commit" => ObjectKind::Commit,
                other => return Err(FractalError::ObjectCodec(format!("unknown kind {other}"))),
            };
            let oid = compute_object_oid(kind, payload);
            let raw = raw_object(kind, payload);
            self.objects
                .lock()
                .map_err(|_| FractalError::ObjectCodec("memory odb mutex poisoned".into()))?
                .insert(oid, raw);
            Ok(oid)
        }

        fn has_object(&self, oid: &Oid) -> bool {
            self.objects
                .lock()
                .map(|guard| guard.contains_key(oid))
                .unwrap_or(false)
        }
    }

    struct PathBufWrapper(std::path::PathBuf);
    impl Drop for PathBufWrapper {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp_git_dir(label: &str) -> PathBufWrapper {
        let base = std::env::var_os("CARGO_TARGET_TMPDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .unwrap_or_default()
                    .join("target")
                    .join("test_tmp")
            });
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = base.join(format!(
            "fg-audit-tree-{label}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(dir.join("refs/fractal/audit")).expect("create git dir");
        PathBufWrapper(dir)
    }

    #[test]
    fn materialize_and_rollup_upward_builds_four_tier_merkle_audit_tree() {
        let odb = MemoryOdb::default();
        let git_dir = temp_git_dir("rollup");
        let sub_ref = FractalRef::SubAgentWorktree {
            cell_id: "cell-a".into(),
            card_id: "card-1".into(),
            subagent_id: "sub-0".into(),
        }
        .audit_counterpart()
        .expect("sub audit ref");
        let sig = GitSignature::for_agent("sub-0", "cell-a", 1_700_000_000);
        let source = Oid::from_bytes([0x44; 20]);

        let sub_res = AuditTreeMaterializer::materialize_with_upward_rollup(
            &odb,
            &git_dir.0,
            &AuditCommitSpec {
                target_ref: &sub_ref,
                message: "async-audit: sub-0 review pass",
                author: &sig,
                source_commit: Some(source),
                rollup_parents: &[],
                entries: &[
                    AuditArtifactEntry {
                        path: "manifest/snapshot.json",
                        payload: br#"{"entries":3}"#,
                    },
                    AuditArtifactEntry {
                        path: "reports/ten_dimensions.json",
                        payload: br#"{"compositeScore":95.2}"#,
                    },
                ],
            },
        )
        .expect("materialize + upward rollup");

        assert_eq!(sub_res.rolled_up_refs.len(), 3);
        assert_eq!(
            sub_res.rolled_up_refs[0].0,
            "refs/fractal/audit/cell/cell-a/card/card-1/main"
        );
        assert_eq!(
            sub_res.rolled_up_refs[1].0,
            "refs/fractal/audit/cell/cell-a/main"
        );
        assert_eq!(sub_res.rolled_up_refs[2].0, "refs/fractal/audit/trunk");

        let read_back = AuditTreeMaterializer::read_audit_artifact(
            &odb,
            &git_dir.0,
            &FractalRef::AuditTrunk,
            "reports/ten_dimensions.json",
        )
        .expect("read trunk artifact")
        .expect("trunk blob exists");
        assert_eq!(read_back, br#"{"compositeScore":95.2}"#);

        let lineage = AuditTreeMaterializer::inspect_audit_lineage(
            &odb,
            &git_dir.0,
            &FractalRef::AuditTrunk,
            5,
        )
        .expect("lineage");
        assert_eq!(lineage.len(), 4);
        assert_eq!(lineage[0].parents.len(), 1);
        assert_eq!(lineage[3].parents.len(), 0);
    }

    #[test]
    fn materialize_refuses_non_audit_refs_fail_closed() {
        let odb = MemoryOdb::default();
        let git_dir = temp_git_dir("non-audit");
        let sig = GitSignature::new("Taxis Bot", "taxis@example.local", 1_700_000_000);
        let worktree_ref = FractalRef::CardWorktree {
            cell_id: "cell-a".into(),
            card_id: "card-1".into(),
        };
        let err = AuditTreeMaterializer::materialize_commit(
            &odb,
            &git_dir.0,
            &AuditCommitSpec {
                target_ref: &worktree_ref,
                message: "forbidden write",
                author: &sig,
                source_commit: None,
                rollup_parents: &[],
                entries: &[],
            },
        )
        .expect_err("non-audit ref must fail closed");
        assert!(matches!(err, FractalError::AccessDenied(_)));
    }
}
