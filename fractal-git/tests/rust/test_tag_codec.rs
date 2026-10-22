//! Module: tests::test_tag_codec — Annotated Tag Object Codec Verification
//! File Path: tests/rust/test_tag_codec.rs
//! Architecture Role: Proves the tag codec reproduces Git's exact payload bytes, so a tag written by
//!   Taxis hashes to the same object id Git would compute for identical content.
//! Dependencies & Triggers: Run by `cargo test --workspace`.
//! Responsibilities: Round-trip a captured real tag payload, reject malformed headers and unknown
//!   target types, preserve a signature block, and accept a tag without a tagger line.
//! Exit Semantics & Design Rationale: The primary assertion compares recomputed object ids against
//!   ids Git itself produced, so a formatting drift in the serializer fails immediately.

use fg_core::models::ObjectKind;
use fractal_git::object::{GitTag, TagCodecError};

/// Payload of an annotated tag captured from a real repository.
///
/// The object id below is the id Git assigned to this exact payload, so recomputing it proves the
/// serializer writes the same bytes rather than merely similar ones.
const CAPTURED_PAYLOAD: &str = concat!(
    "object b2a86dbe1a082baf937ed5188f69e4f0d7475656\n",
    "type commit\n",
    "tag v0.3.8\n",
    "tagger guilingzhouyi <1074494695@qq.com> 1786528897 +0800\n",
    "\n",
    "v0.3.8 — P1 功能批次：热力图/月报+JSON+定时导出/周目标+连续打卡 | P1 feature batch\n"
);

/// Object id Git reported for [`CAPTURED_PAYLOAD`].
const CAPTURED_OID: &str = "5eb9c3f2bf3572696f5e9d26690b10fa7dd8a000";

/// A captured payload re-serializes to the identical bytes and the identical object id.
#[test]
fn a_captured_tag_payload_round_trips_to_the_same_object_id() {
    let parsed = GitTag::parse(CAPTURED_PAYLOAD.as_bytes()).expect("captured payload must parse");
    assert_eq!(parsed.to_payload(), CAPTURED_PAYLOAD.as_bytes());
    assert_eq!(parsed.oid().to_hex(), CAPTURED_OID);
}

/// The four header fields survive parsing unchanged.
#[test]
fn the_header_fields_are_parsed_from_the_payload() {
    let parsed = GitTag::parse(CAPTURED_PAYLOAD.as_bytes()).expect("captured payload must parse");
    assert_eq!(parsed.target_kind, ObjectKind::Commit);
    assert_eq!(parsed.name, "v0.3.8");
    assert_eq!(
        parsed.target_oid.to_hex(),
        "b2a86dbe1a082baf937ed5188f69e4f0d7475656"
    );

    let tagger = parsed.tagger.expect("tagger must be present");
    assert_eq!(tagger.name, "guilingzhouyi");
    assert_eq!(tagger.email, "1074494695@qq.com");
    assert_eq!(tagger.timestamp_sec, 1786528897);
    assert_eq!(tagger.tz_offset, "+0800");
    assert!(parsed.signature.is_none());
}

/// The raw loose object frames the payload with a `tag` header.
#[test]
fn the_raw_object_carries_the_tag_header() {
    let parsed = GitTag::parse(CAPTURED_PAYLOAD.as_bytes()).expect("captured payload must parse");
    let raw = parsed.to_raw_object();
    let expected_prefix = format!("tag {}\0", CAPTURED_PAYLOAD.len());
    assert!(raw.starts_with(expected_prefix.as_bytes()));
    assert!(raw.ends_with(CAPTURED_PAYLOAD.as_bytes()));
}

/// A tag may point at each of the four object types.
#[test]
fn every_object_type_is_accepted_as_a_target() {
    for (type_name, expected_kind) in [
        ("blob", ObjectKind::Blob),
        ("tree", ObjectKind::Tree),
        ("commit", ObjectKind::Commit),
        ("tag", ObjectKind::Tag),
    ] {
        let payload = format!(
            "object 1111111111111111111111111111111111111111\ntype {}\ntag name\n\nbody\n",
            type_name
        );
        let parsed = GitTag::parse(payload.as_bytes()).expect("payload must parse");
        assert_eq!(parsed.target_kind, expected_kind);
    }
}

/// A header type outside the closed set is rejected instead of being guessed.
#[test]
fn an_unknown_target_type_is_rejected() {
    let payload = concat!(
        "object 1111111111111111111111111111111111111111\n",
        "type submodule\n",
        "tag name\n",
        "\n",
        "body\n"
    );
    assert_eq!(
        GitTag::parse(payload.as_bytes()),
        Err(TagCodecError::UnknownTargetType)
    );
}

/// Each required header field reports its own absence.
#[test]
fn a_missing_required_field_reports_which_one_is_absent() {
    let no_object = "type commit\ntag name\n\nbody\n";
    assert_eq!(
        GitTag::parse(no_object.as_bytes()),
        Err(TagCodecError::MissingObjectId)
    );

    let no_type = "object 1111111111111111111111111111111111111111\ntag name\n\nbody\n";
    assert_eq!(
        GitTag::parse(no_type.as_bytes()),
        Err(TagCodecError::MissingTargetType)
    );

    let no_name = "object 1111111111111111111111111111111111111111\ntype commit\n\nbody\n";
    assert_eq!(
        GitTag::parse(no_name.as_bytes()),
        Err(TagCodecError::MissingName)
    );
}

/// An object field that is not a full object id is a distinct failure from a missing one.
#[test]
fn a_short_object_id_is_reported_as_a_bad_id() {
    let payload = "object abc123\ntype commit\ntag name\n\nbody\n";
    assert_eq!(
        GitTag::parse(payload.as_bytes()),
        Err(TagCodecError::BadObjectId)
    );
}

/// A signed tag keeps its signature block and still round-trips.
#[test]
fn a_signed_tag_preserves_the_signature_block() {
    let payload = concat!(
        "object 1111111111111111111111111111111111111111\n",
        "type commit\n",
        "tag signed\n",
        "tagger A <a@example.com> 1700000000 +0000\n",
        "\n",
        "message body\n",
        "-----BEGIN PGP SIGNATURE-----\n",
        "c2lnbmF0dXJl\n",
        "-----END PGP SIGNATURE-----\n"
    );
    let parsed = GitTag::parse(payload.as_bytes()).expect("signed payload must parse");
    assert_eq!(parsed.message, "message body\n");
    let signature = parsed.signature.as_ref().expect("signature must be kept");
    assert!(signature.starts_with("-----BEGIN PGP SIGNATURE-----"));
    assert_eq!(parsed.to_payload(), payload.as_bytes());
}

/// A tag written without a tagger line is legal and round-trips unchanged.
#[test]
fn a_tag_without_a_tagger_line_round_trips() {
    let payload =
        "object 1111111111111111111111111111111111111111\ntype commit\ntag minimal\n\nbody\n";
    let parsed = GitTag::parse(payload.as_bytes()).expect("tagger is optional");
    assert!(parsed.tagger.is_none());
    assert_eq!(parsed.to_payload(), payload.as_bytes());
}

/// The root facade re-export is the same type the object crate defines, not a parallel copy.
#[test]
fn the_root_facade_export_is_the_same_type() {
    fn assert_same_type(_: fractal_git::GitTag) {}
    let parsed = GitTag::parse(CAPTURED_PAYLOAD.as_bytes()).expect("captured payload must parse");
    assert_same_type(parsed);
}
