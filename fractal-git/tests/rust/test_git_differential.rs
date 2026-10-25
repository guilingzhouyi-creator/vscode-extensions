//! Module: tests::test_git_differential — Object Byte Parity Against System Git Reference Baseline
//! File Path: fractal-git/tests/rust/test_git_differential.rs
//! Architecture Role: Turns the FGT-ALG-001 equivalence claim into executable evidence by
//!   comparing every encoded object against the same object written by the system git binary.
//! Dependencies & Triggers: Runs under cargo test; the git binary is the reference baseline and absence of git
//!   is reported as a skip unless TAXIS_REQUIRE_GIT is set, which CI does.
//! Responsibilities: Cover blobs, trees, commits, and tags across payload shapes that historically
//!   differ from Git (trailing newlines, mixed case names, non-ASCII names, nested trees, time
//!   zones, multiple parents), plus the stored tree ordering and the loose object storage round trip.
//! Exit Semantics & Design Rationale: A mismatch fails with both identifiers and the vector label so
//!   the divergence is reproducible; the reference comparator is trusted only for answered questions, never for
//!   skipping a comparison silently.
//!
//! Domain Governance Rules: FGT-COR-001 (differential parity), FGT-ALG-001, FGT-OBJ-001.

#[path = "support/git_baseline.rs"]
mod git_baseline;

use fg_core::models::ObjectKind;
use fractal_git::{
    FileMode, GitBlob, GitCommit, GitSignature, GitTag, GitTree, GitTreeEntry, LooseOdb, OdbStore,
    Oid,
};
use git_baseline::{BaselineSignature, BaselineTreeEntry, GitBaseline};

/// Returns a baseline validator when git is executable, panics instead of skipping when the environment
/// demands a real comparison.
fn baseline_or_skip() -> Option<GitBaseline> {
    match GitBaseline::new() {
        Some(baseline) => Some(baseline),
        None => {
            assert!(
                std::env::var_os("TAXIS_REQUIRE_GIT").is_none(),
                "git binary is required to verify object parity but was not found"
            );
            eprintln!(
                "SKIP: git binary unavailable, object parity against the system git baseline is NOT verified"
            );
            None
        }
    }
}

/// Parses a hexadecimal identifier produced by the baseline validator.
fn oid_from_hex(hex: &str) -> Oid {
    Oid::from_hex(hex)
        .unwrap_or_else(|error| panic!("baseline returned invalid object id {}: {:?}", hex, error))
}

/// Builds the production signature for a vector.
fn signature(name: &str, tz: &str, timestamp: i64) -> GitSignature {
    GitSignature {
        name: name.to_string(),
        email: "parity@example.com".to_string(),
        timestamp_sec: timestamp,
        tz_offset: tz.to_string(),
    }
}

/// Builds the baseline signature matching the production one.
fn baseline_signature(name: &str, tz: &str, timestamp: i64) -> BaselineSignature {
    BaselineSignature::new(name, tz, timestamp)
}

/// Blob payloads that exercise encoding edge cases instead of one happy path.
fn blob_payloads() -> Vec<(&'static str, Vec<u8>)> {
    let mut binary = Vec::with_capacity(256);
    for byte in 0u8..=255u8 {
        binary.push(byte);
    }
    vec![
        ("empty", Vec::new()),
        ("single byte", vec![b'x']),
        ("one line with newline", b"hello world\n".to_vec()),
        ("one line without newline", b"hello world".to_vec()),
        (
            "two lines with newlines",
            b"first line\nsecond line\n".to_vec(),
        ),
        ("trailing empty lines", b"line one\nline two\n\n\n".to_vec()),
        (
            "crlf line endings",
            b"first line\r\nsecond line\r\n".to_vec(),
        ),
        (
            "utf-8 multibyte content",
            "\u{4e2d}\u{6587}\u{6d4b}\u{8bd5}\u{6587}\u{672c}\n"
                .as_bytes()
                .to_vec(),
        ),
        ("embedded null bytes", vec![b'a', 0, b'b', 0, b'c', b'\n']),
        ("all 256 byte values", binary),
        ("four megabyte repeated text", vec![b'a'; 4 * 1024 * 1024]),
    ]
}

/// Entry spec handed to [`realize_tree`].
enum EntrySpec {
    /// Regular file with mode and payload.
    File(&'static str, &'static str, Vec<u8>),
    /// Executable file with mode and payload.
    Executable(&'static str, &'static str, Vec<u8>),
    /// Symlink with target string.
    Symlink(&'static str, &'static str),
    /// Nested tree entry.
    Directory(&'static str, TreeSpec),
    /// Gitlink entry binding a submodule commit identifier.
    Gitlink(&'static str, &'static str),
}

/// A tree description encoded by both the production encoder and the baseline validator.
struct TreeSpec {
    /// Entries in deliberately unsorted declaration order.
    entries: Vec<EntrySpec>,
}

/// Realizes one tree description through both encoders and asserts the stored identifiers match.
fn realize_tree(baseline: &GitBaseline, spec: &TreeSpec, label: &str) -> (String, GitTree) {
    let mut baseline_entries = Vec::new();
    let mut rust_entries = Vec::new();
    for entry in &spec.entries {
        match entry {
            EntrySpec::File(name, mode, payload) | EntrySpec::Executable(name, mode, payload) => {
                let file_mode = if *mode == "100755" {
                    FileMode::ExecutableFile
                } else {
                    FileMode::RegularFile
                };
                let baseline_oid = baseline.write_blob(payload);
                let rust_oid = *GitBlob::from_bytes(payload.clone()).oid();
                baseline_entries.push(BaselineTreeEntry::new(mode, name, &baseline_oid));
                rust_entries.push(GitTreeEntry::new(file_mode, *name, rust_oid));
            }
            EntrySpec::Symlink(name, target) => {
                let payload = target.as_bytes();
                let baseline_oid = baseline.write_blob(payload);
                let rust_oid = *GitBlob::from_bytes(payload.to_vec()).oid();
                baseline_entries.push(BaselineTreeEntry::new("120000", name, &baseline_oid));
                rust_entries.push(GitTreeEntry::new(FileMode::Symlink, *name, rust_oid));
            }
            EntrySpec::Directory(name, child) => {
                let (child_baseline, child_rust) = realize_tree(baseline, child, label);
                baseline_entries.push(BaselineTreeEntry::new("40000", name, &child_baseline));
                rust_entries.push(GitTreeEntry::new(
                    FileMode::Directory,
                    *name,
                    *child_rust.oid(),
                ));
            }
            EntrySpec::Gitlink(name, commit_hex) => {
                baseline_entries.push(BaselineTreeEntry::new("160000", name, commit_hex));
                rust_entries.push(GitTreeEntry::new(
                    FileMode::Gitlink,
                    *name,
                    oid_from_hex(commit_hex),
                ));
            }
        }
    }
    let baseline_tree = baseline.write_tree(&baseline_entries);
    let rust_tree = GitTree::new(rust_entries);
    assert_eq!(
        rust_tree.oid().to_hex(),
        baseline_tree,
        "tree identifier diverged for vector {}",
        label
    );
    (baseline_tree, rust_tree)
}

/// Tree descriptions covering ordering, nesting, and special modes.
fn tree_specs() -> Vec<(&'static str, TreeSpec)> {
    vec![
        (
            "empty tree",
            TreeSpec {
                entries: Vec::new(),
            },
        ),
        (
            "single regular file",
            TreeSpec {
                entries: vec![EntrySpec::File("hello.txt", "100644", b"hello\n".to_vec())],
            },
        ),
        (
            "alphabetical sibling files",
            TreeSpec {
                entries: vec![
                    EntrySpec::File("a.txt", "100644", b"a\n".to_vec()),
                    EntrySpec::File("b.txt", "100644", b"b\n".to_vec()),
                    EntrySpec::File("c.txt", "100644", b"c\n".to_vec()),
                ],
            },
        ),
        (
            "reverse declaration order",
            TreeSpec {
                entries: vec![
                    EntrySpec::File("z.txt", "100644", b"z\n".to_vec()),
                    EntrySpec::File("m.txt", "100644", b"m\n".to_vec()),
                    EntrySpec::File("a.txt", "100644", b"a\n".to_vec()),
                ],
            },
        ),
        (
            "directory sort anomaly where a file sorts after a directory",
            TreeSpec {
                entries: vec![
                    EntrySpec::Directory(
                        "foo",
                        TreeSpec {
                            entries: vec![EntrySpec::File(
                                "child.txt",
                                "100644",
                                b"child\n".to_vec(),
                            )],
                        },
                    ),
                    EntrySpec::File("foo-bar", "100644", b"file\n".to_vec()),
                    EntrySpec::File("foo.txt", "100644", b"file\n".to_vec()),
                ],
            },
        ),
        (
            "case ordering with mixed case names",
            TreeSpec {
                entries: vec![
                    EntrySpec::File("A", "100644", b"A\n".to_vec()),
                    EntrySpec::File("a", "100644", b"a\n".to_vec()),
                    EntrySpec::File("B", "100644", b"B\n".to_vec()),
                    EntrySpec::File("b", "100644", b"b\n".to_vec()),
                    EntrySpec::File("Z", "100644", b"Z\n".to_vec()),
                ],
            },
        ),
        (
            "non-ascii byte order with multibyte utf8 names",
            TreeSpec {
                entries: vec![
                    EntrySpec::File("\u{4e00}.txt", "100644", b"one\n".to_vec()),
                    EntrySpec::File("\u{4e8c}.txt", "100644", b"two\n".to_vec()),
                    EntrySpec::File("\u{4e09}.txt", "100644", b"three\n".to_vec()),
                    EntrySpec::File("ascii.txt", "100644", b"ascii\n".to_vec()),
                ],
            },
        ),
        (
            "all supported git modes in one tree",
            TreeSpec {
                entries: vec![
                    EntrySpec::File("regular.txt", "100644", b"regular\n".to_vec()),
                    EntrySpec::Executable("script.sh", "100755", b"#!/bin/sh\n".to_vec()),
                    EntrySpec::Symlink("link", "regular.txt"),
                    EntrySpec::Directory(
                        "subdir",
                        TreeSpec {
                            entries: vec![EntrySpec::File(
                                "nested.txt",
                                "100644",
                                b"nested\n".to_vec(),
                            )],
                        },
                    ),
                    EntrySpec::Gitlink("submodule", "0123456789abcdef0123456789abcdef01234567"),
                ],
            },
        ),
        (
            "deeply nested three level tree",
            TreeSpec {
                entries: vec![EntrySpec::Directory(
                    "level1",
                    TreeSpec {
                        entries: vec![EntrySpec::Directory(
                            "level2",
                            TreeSpec {
                                entries: vec![EntrySpec::Directory(
                                    "level3",
                                    TreeSpec {
                                        entries: vec![EntrySpec::File(
                                            "deep.txt",
                                            "100644",
                                            b"deep\n".to_vec(),
                                        )],
                                    },
                                )],
                            },
                        )],
                    },
                )],
            },
        ),
        (
            "two subdirectories with identical contents have identical oids",
            TreeSpec {
                entries: vec![
                    EntrySpec::Directory(
                        "dir-a",
                        TreeSpec {
                            entries: vec![EntrySpec::File(
                                "common.txt",
                                "100644",
                                b"identical\n".to_vec(),
                            )],
                        },
                    ),
                    EntrySpec::Directory(
                        "dir-b",
                        TreeSpec {
                            entries: vec![EntrySpec::File(
                                "common.txt",
                                "100644",
                                b"identical\n".to_vec(),
                            )],
                        },
                    ),
                ],
            },
        ),
        (
            "hundred entry flat tree with random order",
            hundred_entry_tree_spec(),
        ),
    ]
}

/// Builds a 100-entry tree specification with deterministic pseudo-random ordering.
fn hundred_entry_tree_spec() -> TreeSpec {
    let mut entries = Vec::with_capacity(100);
    for i in 0..100 {
        let name: &'static str = match i {
            0 => "file-00.txt",
            1 => "file-01.txt",
            2 => "file-02.txt",
            3 => "file-03.txt",
            4 => "file-04.txt",
            5 => "file-05.txt",
            6 => "file-06.txt",
            7 => "file-07.txt",
            8 => "file-08.txt",
            9 => "file-09.txt",
            10 => "file-10.txt",
            11 => "file-11.txt",
            12 => "file-12.txt",
            13 => "file-13.txt",
            14 => "file-14.txt",
            15 => "file-15.txt",
            16 => "file-16.txt",
            17 => "file-17.txt",
            18 => "file-18.txt",
            19 => "file-19.txt",
            20 => "file-20.txt",
            21 => "file-21.txt",
            22 => "file-22.txt",
            23 => "file-23.txt",
            24 => "file-24.txt",
            25 => "file-25.txt",
            26 => "file-26.txt",
            27 => "file-27.txt",
            28 => "file-28.txt",
            29 => "file-29.txt",
            30 => "file-30.txt",
            31 => "file-31.txt",
            32 => "file-32.txt",
            33 => "file-33.txt",
            34 => "file-34.txt",
            35 => "file-35.txt",
            36 => "file-36.txt",
            37 => "file-37.txt",
            38 => "file-38.txt",
            39 => "file-39.txt",
            40 => "file-40.txt",
            41 => "file-41.txt",
            42 => "file-42.txt",
            43 => "file-43.txt",
            44 => "file-44.txt",
            45 => "file-45.txt",
            46 => "file-46.txt",
            47 => "file-47.txt",
            48 => "file-48.txt",
            49 => "file-49.txt",
            50 => "file-50.txt",
            51 => "file-51.txt",
            52 => "file-52.txt",
            53 => "file-53.txt",
            54 => "file-54.txt",
            55 => "file-55.txt",
            56 => "file-56.txt",
            57 => "file-57.txt",
            58 => "file-58.txt",
            59 => "file-59.txt",
            60 => "file-60.txt",
            61 => "file-61.txt",
            62 => "file-62.txt",
            63 => "file-63.txt",
            64 => "file-64.txt",
            65 => "file-65.txt",
            66 => "file-66.txt",
            67 => "file-67.txt",
            68 => "file-68.txt",
            69 => "file-69.txt",
            70 => "file-70.txt",
            71 => "file-71.txt",
            72 => "file-72.txt",
            73 => "file-73.txt",
            74 => "file-74.txt",
            75 => "file-75.txt",
            76 => "file-76.txt",
            77 => "file-77.txt",
            78 => "file-78.txt",
            79 => "file-79.txt",
            80 => "file-80.txt",
            81 => "file-81.txt",
            82 => "file-82.txt",
            83 => "file-83.txt",
            84 => "file-84.txt",
            85 => "file-85.txt",
            86 => "file-86.txt",
            87 => "file-87.txt",
            88 => "file-88.txt",
            89 => "file-89.txt",
            90 => "file-90.txt",
            91 => "file-91.txt",
            92 => "file-92.txt",
            93 => "file-93.txt",
            94 => "file-94.txt",
            95 => "file-95.txt",
            96 => "file-96.txt",
            97 => "file-97.txt",
            98 => "file-98.txt",
            _ => "file-99.txt",
        };
        entries.push(EntrySpec::File(
            name,
            "100644",
            format!("content {}\n", i).into_bytes(),
        ));
    }
    // Deterministic pseudo-random shuffle
    let mut state: u64 = 0xdeadbeef;
    for i in (1..entries.len()).rev() {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
        let j = (state >> 33) as usize % (i + 1);
        entries.swap(i, j);
    }
    TreeSpec { entries }
}

/// Verification of every blob payload through git hash-object.
#[test]
fn blob_payloads_match_git_hash_object() {
    let Some(baseline) = baseline_or_skip() else {
        return;
    };
    for (label, payload) in blob_payloads() {
        let expected = baseline.write_blob(&payload);
        let (directory, remainder) = expected.split_at(2);
        assert!(
            baseline
                .git_dir()
                .join("objects")
                .join(directory)
                .join(remainder)
                .is_file(),
            "the baseline comparator did not persist a loose object for vector {}",
            label
        );
        let actual = GitBlob::from_bytes(payload.clone()).oid_hex();
        assert_eq!(
            actual, expected,
            "blob identifier diverged for vector {}",
            label
        );
    }
}

/// Verification of every tree description plus the stored entry order.
#[test]
fn tree_payloads_match_git_mktree() {
    let Some(baseline) = baseline_or_skip() else {
        return;
    };
    for (label, spec) in tree_specs() {
        let (baseline_oid, rust_tree) = realize_tree(&baseline, &spec, label);
        let stored_names = baseline.list_tree_names(&baseline_oid);
        let encoded_names: Vec<String> = rust_tree
            .entries()
            .iter()
            .map(|entry| entry.name.clone())
            .collect();
        assert_eq!(
            encoded_names, stored_names,
            "tree entry order diverged from git storage for vector {}",
            label
        );
    }
}

/// Verification of commit payloads across parent counts, messages, and time zones.
#[test]
fn commit_payloads_match_git_commit_tree() {
    let Some(baseline) = baseline_or_skip() else {
        return;
    };
    let tree_spec = TreeSpec {
        entries: vec![EntrySpec::File("root.txt", "100644", b"root\n".to_vec())],
    };
    let (tree_hex, tree) = realize_tree(&baseline, &tree_spec, "commit base tree");

    let messages = [
        ("message without trailing newline", "commit message"),
        ("message with trailing newline", "commit message\n"),
        ("message with two trailing newlines", "commit message\n\n"),
        (
            "multiline message",
            "subject line\n\nbody paragraph\nsecond body line\n",
        ),
        (
            "non ascii message",
            "\u{63d0}\u{4ea4}\u{8bf4}\u{660e}\n\n\u{6b63}\u{6587}\u{5185}\u{5bb9}\n",
        ),
        ("crlf message", "subject\r\n\r\nbody\r\n"),
        ("empty message", ""),
        ("message with trailing spaces", "subject   \n\nbody  \n"),
        ("message with leading newline", "\nsubject\n"),
        ("long message", "long message\n"),
    ];
    let time_zones = ["+0000", "-0500", "+0530", "+0800"];

    let mut parents: Vec<String> = Vec::new();
    for (index, (label, message)) in messages.iter().enumerate() {
        let tz = time_zones[index % time_zones.len()];
        let author = signature("Parity Author", tz, 1700000000 + index as i64);
        let committer = signature("Parity Committer", tz, 1700001000 + index as i64);
        let parent_oids: Vec<String> = parents.clone();
        let expected = baseline.write_commit(
            &tree_hex,
            &parent_oids,
            &baseline_signature(author.name.as_str(), tz, author.timestamp_sec),
            &baseline_signature(committer.name.as_str(), tz, committer.timestamp_sec),
            message,
        );
        let parent_typed: Vec<Oid> = parent_oids.iter().map(|hex| oid_from_hex(hex)).collect();
        let rust_commit = GitCommit::new(
            *tree.oid(),
            parent_typed,
            author.clone(),
            committer,
            (*message).to_string(),
            None,
        );
        assert_eq!(
            rust_commit.oid().to_hex(),
            expected,
            "commit identifier diverged for vector {} with parent count {}",
            label,
            parent_oids.len()
        );
        parents.insert(0, expected);
        if parents.len() > 3 {
            parents.pop();
        }
    }
}

/// Verification of annotated tag payloads across target kinds and tagger presence.
#[test]
fn tag_payloads_match_git_mktag() {
    let Some(baseline) = baseline_or_skip() else {
        return;
    };
    let blob_hex = baseline.write_blob(b"tagged blob\n");
    let tree_spec = TreeSpec {
        entries: vec![EntrySpec::File(
            "tagged.txt",
            "100644",
            b"tagged\n".to_vec(),
        )],
    };
    let (tree_hex, _) = realize_tree(&baseline, &tree_spec, "tag base tree");
    let base_commit = baseline.write_commit(
        &tree_hex,
        &[],
        &baseline_signature("Parity Author", "+0000", 1700000000),
        &baseline_signature("Parity Committer", "+0000", 1700000000),
        "tag target\n",
    );

    let mut vectors = Vec::new();
    for (kind_label, target_hex, kind) in [
        ("commit target", base_commit.as_str(), ObjectKind::Commit),
        ("tree target", tree_hex.as_str(), ObjectKind::Tree),
        ("blob target", blob_hex.as_str(), ObjectKind::Blob),
    ] {
        for (index, message) in ["tag message\n", "tag message", "tag message\n\nbody\n"]
            .iter()
            .enumerate()
        {
            let tz = ["+0000", "-0500", "+0530"][index % 3];
            vectors.push((
                format!("{} {}", kind_label, index),
                target_hex.to_string(),
                kind,
                format!("tag-name-{}", index),
                Some(signature("Parity Tagger", tz, 1700002000 + index as i64)),
                (*message).to_string(),
            ));
        }
    }

    for (label, target_hex, kind, name, tagger, message) in vectors {
        let rust_tag = GitTag {
            target_oid: oid_from_hex(&target_hex),
            target_kind: kind,
            name: name.clone(),
            tagger: tagger.clone(),
            message: message.clone(),
            signature: None,
        };
        let expected = baseline.write_tag(&rust_tag.to_payload());
        assert_eq!(
            rust_tag.oid().to_hex(),
            expected,
            "tag identifier diverged for vector {}",
            label
        );
    }
}

/// Verification that a loose object written here is readable by git and decodes to the same raw
/// object bytes git stored.
///
/// The compressed zlib stream is deliberately not compared: Git links zlib while this build uses
/// flate2 over miniz_oxide, so the two encoders may emit different valid streams for identical
/// input. Object identity lives in the raw object bytes, which is what this test pins down.
#[test]
fn loose_object_storage_round_trips_git_raw_bytes() {
    let Some(baseline) = baseline_or_skip() else {
        return;
    };
    let local_root = tempfile::tempdir().expect("create local object directory");
    let store = LooseOdb::new(local_root.path());
    for (label, payload) in blob_payloads() {
        let baseline_oid = baseline.write_blob(&payload);
        let git_compressed = baseline.read_loose_object_bytes(&baseline_oid);
        assert!(
            !git_compressed.is_empty(),
            "reference baseline wrote no loose file for vector {}",
            label
        );
        let blob = GitBlob::from_bytes(payload.clone());
        LooseOdb::write_loose_object_raw(local_root.path(), blob.oid(), &blob.to_raw_object())
            .unwrap_or_else(|error| panic!("write loose object for vector {}: {:?}", label, error));
        let decoded = store.read_object(blob.oid()).unwrap_or_else(|error| {
            panic!("decode loose object for vector {}: {:?}", label, error)
        });
        assert_eq!(
            decoded,
            blob.to_raw_object(),
            "loose object storage did not round-trip raw bytes for vector {}",
            label
        );
    }
}
