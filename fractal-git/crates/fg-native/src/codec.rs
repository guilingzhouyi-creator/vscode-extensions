//! Module: fg-native — TAXC Field Codec Primitives
//! File Path: crates/fg-native/src/codec.rs
//! Architecture Role: Shared binary field reader/writer used by every TAXC section codec.
//! Dependencies & Triggers: Consumed by sections/meta.rs, head.rs, refs.rs and the record-stream
//!   codecs; nothing in this module knows about sections or repository semantics.
//! Responsibilities: Little-endian scalar read/write, length-prefixed UTF-8 strings, optional
//!   object ids, and a bounds-checked record cursor for sequential scanning.
//! Exit Semantics & Design Rationale:
//!   - Every read is bounds-checked against the remaining slice and reports the field name, so a
//!     truncated section names the exact field that ran out of bytes rather than a generic failure.
//!   - Strings carry a `u16` length prefix and must be valid UTF-8 with no interior NUL: a NUL
//!     would make the field ambiguous with the `\0`-terminated conventions used elsewhere, and
//!     silent replacement characters would hide corruption.
//!   - The writer mirrors the reader exactly; a value written by `write_*` must be reproduced
//!     bit-for-bit by the matching `read_*`. Round-trip tests pin that contract.

use fg_core::models::Oid;

use crate::constants::MAX_FIELD_LEN;
use crate::error::{NativeError, NativeResult};

/// Sequential, bounds-checked reader over a section payload.
#[derive(Debug, Clone)]
pub struct FieldReader<'a> {
    payload: &'a [u8],
    cursor: usize,
}

impl<'a> FieldReader<'a> {
    /// Creates a reader positioned at the start of `payload`.
    pub const fn new(payload: &'a [u8]) -> Self {
        Self { payload, cursor: 0 }
    }

    /// Returns the number of bytes not yet consumed.
    pub fn remaining(&self) -> usize {
        self.payload.len().saturating_sub(self.cursor)
    }

    /// Returns the current absolute offset inside the payload.
    pub const fn offset(&self) -> usize {
        self.cursor
    }

    /// Reports whether the payload is fully consumed.
    pub fn is_exhausted(&self) -> bool {
        self.remaining() == 0
    }

    /// Reads one byte.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when no byte remains.
    pub fn read_u8(&mut self, field: &'static str) -> NativeResult<u8> {
        let slice = self.take(field, 1)?;
        Ok(slice[0])
    }

    /// Reads a little-endian `u16`.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than two bytes remain.
    pub fn read_u16(&mut self, field: &'static str) -> NativeResult<u16> {
        let slice = self.take(field, 2)?;
        Ok(u16::from_le_bytes([slice[0], slice[1]]))
    }

    /// Reads a little-endian `u32`.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than four bytes remain.
    pub fn read_u32(&mut self, field: &'static str) -> NativeResult<u32> {
        let slice = self.take(field, 4)?;
        Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
    }

    /// Reads a little-endian `u64`.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than eight bytes remain.
    pub fn read_u64(&mut self, field: &'static str) -> NativeResult<u64> {
        let slice = self.take(field, 8)?;
        let mut word = [0u8; 8];
        word.copy_from_slice(slice);
        Ok(u64::from_le_bytes(word))
    }

    /// Reads a little-endian `i64`.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than eight bytes remain.
    pub fn read_i64(&mut self, field: &'static str) -> NativeResult<i64> {
        let raw = self.read_u64(field)?;
        Ok(i64::from_le_bytes(raw.to_le_bytes()))
    }

    /// Reads an `f64` stored as its IEEE-754 bit pattern.
    ///
    /// Storing the bit pattern rather than a decimal rendering is the only way to guarantee
    /// bit-exact round trips for `NaN`, `-0.0`, and extreme exponents.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than eight bytes remain.
    pub fn read_f64_bits(&mut self, field: &'static str) -> NativeResult<f64> {
        let raw = self.read_u64(field)?;
        Ok(f64::from_bits(raw))
    }

    /// Reads a fixed 20-byte object id.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than twenty bytes remain.
    pub fn read_oid(&mut self, field: &'static str) -> NativeResult<Oid> {
        let slice = self.take(field, 20)?;
        let mut raw = [0u8; 20];
        raw.copy_from_slice(slice);
        Ok(Oid::from_bytes(raw))
    }

    /// Reads an object id where an all-zero value encodes absence.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than twenty bytes remain.
    pub fn read_optional_oid(&mut self, field: &'static str) -> NativeResult<Option<Oid>> {
        let oid = self.read_oid(field)?;
        if oid == Oid::ZERO {
            Ok(None)
        } else {
            Ok(Some(oid))
        }
    }

    /// Reads a `u16`-length-prefixed UTF-8 string.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] when the length prefix or the body is short,
    /// [`NativeError::InvalidUtf8`] when the bytes are not UTF-8, and
    /// [`NativeError::InteriorNul`] when the decoded text contains a NUL byte.
    pub fn read_string(&mut self, field: &'static str) -> NativeResult<String> {
        let length = self.read_u16(field)? as usize;
        if length > MAX_FIELD_LEN {
            return Err(NativeError::CountExceeded {
                field,
                declared: length,
                ceiling: MAX_FIELD_LEN,
            });
        }

        let slice = self.take(field, length)?;
        if let Some(index) = slice.iter().position(|byte| *byte == 0) {
            return Err(NativeError::InteriorNul { field, index });
        }

        std::str::from_utf8(slice)
            .map(str::to_owned)
            .map_err(|parse_err| NativeError::InvalidUtf8 {
                field,
                reason: parse_error_reason(parse_err),
            })
    }

    /// Borrows the next `length` bytes without copying.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] naming `field` when fewer than `length` bytes remain.
    pub fn take(&mut self, field: &'static str, length: usize) -> NativeResult<&'a [u8]> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(NativeError::FieldOverrun {
                field,
                needed: length,
                available: self.remaining(),
            })?;

        let slice = self
            .payload
            .get(self.cursor..end)
            .ok_or(NativeError::FieldOverrun {
                field,
                needed: length,
                available: self.remaining(),
            })?;

        self.cursor = end;
        Ok(slice)
    }

    /// Fails when unconsumed bytes remain, naming the section that is over-long.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::TruncatedRecord`] carrying the leftover count.
    pub fn expect_exhausted(&self, tag: &'static str) -> NativeResult<()> {
        if self.is_exhausted() {
            Ok(())
        } else {
            Err(NativeError::TruncatedRecord {
                tag,
                remaining: self.remaining(),
            })
        }
    }
}

/// Renders a UTF-8 decode failure as a stable, allocation-light description.
fn parse_error_reason(parse_err: std::str::Utf8Error) -> String {
    let valid_up_to = parse_err.valid_up_to();
    let mut reason = String::with_capacity(48);
    reason.push_str("invalid byte sequence at index ");
    reason.push_str(&valid_up_to.to_string());
    reason
}

/// Append-only writer producing the byte layout that [`FieldReader`] consumes.
#[derive(Debug, Default)]
pub struct FieldWriter {
    buffer: Vec<u8>,
}

impl FieldWriter {
    /// Creates an empty writer.
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }

    /// Creates a writer with pre-reserved capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            buffer: Vec::with_capacity(capacity),
        }
    }

    /// Appends one byte.
    pub fn write_u8(&mut self, value: u8) {
        self.buffer.push(value);
    }

    /// Appends a little-endian `u16`.
    pub fn write_u16(&mut self, value: u16) {
        self.buffer.extend_from_slice(&value.to_le_bytes());
    }

    /// Appends a little-endian `u32`.
    pub fn write_u32(&mut self, value: u32) {
        self.buffer.extend_from_slice(&value.to_le_bytes());
    }

    /// Appends a little-endian `u64`.
    pub fn write_u64(&mut self, value: u64) {
        self.buffer.extend_from_slice(&value.to_le_bytes());
    }

    /// Appends a little-endian `i64`.
    pub fn write_i64(&mut self, value: i64) {
        self.buffer.extend_from_slice(&value.to_le_bytes());
    }

    /// Appends an `f64` as its IEEE-754 bit pattern.
    pub fn write_f64_bits(&mut self, value: f64) {
        self.buffer
            .extend_from_slice(&value.to_bits().to_le_bytes());
    }

    /// Appends a 20-byte object id.
    pub fn write_oid(&mut self, oid: &Oid) {
        self.buffer.extend_from_slice(oid.as_bytes());
    }

    /// Appends an optional object id, encoding absence as twenty zero bytes.
    pub fn write_optional_oid(&mut self, oid: Option<&Oid>) {
        match oid {
            Some(present) => self.write_oid(present),
            None => self.buffer.extend_from_slice(&[0u8; 20]),
        }
    }

    /// Appends a `u16`-length-prefixed UTF-8 string.
    ///
    /// # Errors
    ///
    /// Returns [`NativeError::FieldOverrun`] when the text exceeds the `u16` length ceiling, and
    /// [`NativeError::InteriorNul`] when the text contains a NUL byte.
    pub fn write_string(&mut self, field: &'static str, value: &str) -> NativeResult<()> {
        if let Some(index) = value.as_bytes().iter().position(|byte| *byte == 0) {
            return Err(NativeError::InteriorNul { field, index });
        }

        let length = value.len();
        if length > u16::MAX as usize {
            return Err(NativeError::FieldOverrun {
                field,
                needed: length,
                available: u16::MAX as usize,
            });
        }

        self.write_u16(length as u16);
        self.buffer.extend_from_slice(value.as_bytes());
        Ok(())
    }

    /// Appends raw bytes.
    pub fn write_bytes(&mut self, payload: &[u8]) {
        self.buffer.extend_from_slice(payload);
    }

    /// Appends `count` zero bytes.
    ///
    /// Used for fixed-width reserved regions such as an unobserved stat cache, where writing the
    /// zeros explicitly keeps the record width identical to an observed one.
    pub fn extend_zeros(&mut self, count: usize) {
        self.buffer.resize(self.buffer.len() + count, 0);
    }

    /// Returns the number of bytes written so far.
    pub fn len(&self) -> usize {
        self.buffer.len()
    }

    /// Reports whether nothing has been written.
    pub fn is_empty(&self) -> bool {
        self.buffer.is_empty()
    }

    /// Consumes the writer and returns the accumulated bytes.
    pub fn finish(self) -> Vec<u8> {
        self.buffer
    }
}

#[cfg(test)]
mod tests {
    use fg_core::models::Oid;

    use super::{FieldReader, FieldWriter};
    use crate::error::NativeError;

    fn oid_from(seed: u8) -> Oid {
        let mut raw = [0u8; 20];
        raw[0] = seed;
        raw[19] = seed.wrapping_mul(7);
        Oid::from_bytes(raw)
    }

    #[test]
    fn scalar_round_trip() {
        let mut writer = FieldWriter::new();
        writer.write_u8(0xAB);
        writer.write_u16(0xBEEF);
        writer.write_u32(0xDEAD_BEEF);
        writer.write_u64(0x0123_4567_89AB_CDEF);
        writer.write_i64(-42);
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(reader.read_u8("byte").expect("u8"), 0xAB);
        assert_eq!(reader.read_u16("half").expect("u16"), 0xBEEF);
        assert_eq!(reader.read_u32("word").expect("u32"), 0xDEAD_BEEF);
        assert_eq!(
            reader.read_u64("dword").expect("u64"),
            0x0123_4567_89AB_CDEF
        );
        assert_eq!(reader.read_i64("stamp").expect("i64"), -42);
        assert!(reader.is_exhausted());
    }

    #[test]
    fn float_bits_round_trip_exactly() {
        let samples = [
            0.0f64,
            -0.0,
            1.0 / 3.0,
            f64::MAX,
            f64::MIN_POSITIVE,
            f64::INFINITY,
            f64::NEG_INFINITY,
        ];
        for sample in samples {
            let mut writer = FieldWriter::new();
            writer.write_f64_bits(sample);
            let bytes = writer.finish();
            let mut reader = FieldReader::new(&bytes);
            let decoded = reader.read_f64_bits("score").expect("f64");
            assert_eq!(
                decoded.to_bits(),
                sample.to_bits(),
                "bit pattern must survive"
            );
        }
    }

    #[test]
    fn nan_bit_pattern_survives() {
        let mut writer = FieldWriter::new();
        writer.write_f64_bits(f64::NAN);
        let bytes = writer.finish();
        let mut reader = FieldReader::new(&bytes);
        let decoded = reader.read_f64_bits("score").expect("f64");
        assert!(decoded.is_nan());
        assert_eq!(decoded.to_bits(), f64::NAN.to_bits());
    }

    #[test]
    fn string_round_trip() {
        let mut writer = FieldWriter::new();
        writer
            .write_string("name", "refs/heads/main")
            .expect("write");
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(reader.read_string("name").expect("read"), "refs/heads/main");
        assert!(reader.is_exhausted());
    }

    #[test]
    fn empty_string_round_trip() {
        let mut writer = FieldWriter::new();
        writer.write_string("name", "").expect("write");
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(reader.read_string("name").expect("read"), "");
    }

    #[test]
    fn utf8_multibyte_round_trip() {
        let mut writer = FieldWriter::new();
        writer
            .write_string("name", "引用/主干-日本語")
            .expect("write");
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(
            reader.read_string("name").expect("read"),
            "引用/主干-日本語"
        );
    }

    #[test]
    fn rejects_interior_nul_on_write() {
        let mut writer = FieldWriter::new();
        let error = writer
            .write_string("name", "bad\0value")
            .expect_err("NUL must be rejected");
        assert!(matches!(error, NativeError::InteriorNul { index: 3, .. }));
    }

    #[test]
    fn rejects_interior_nul_on_read() {
        let payload = [0x03u8, 0x00, b'a', 0x00, b'b'];
        let mut reader = FieldReader::new(&payload);
        let error = reader
            .read_string("name")
            .expect_err("NUL must be rejected");
        assert!(matches!(error, NativeError::InteriorNul { .. }));
    }

    #[test]
    fn rejects_invalid_utf8() {
        let payload = [0x02u8, 0x00, 0xFF, 0xFE];
        let mut reader = FieldReader::new(&payload);
        let error = reader
            .read_string("name")
            .expect_err("invalid UTF-8 must fail");
        assert!(matches!(error, NativeError::InvalidUtf8 { .. }));
    }

    #[test]
    fn reports_overrun_with_field_name() {
        let payload = [0x01u8];
        let mut reader = FieldReader::new(&payload);
        let error = reader.read_u32("mode").expect_err("short read must fail");
        match error {
            NativeError::FieldOverrun {
                field,
                needed,
                available,
            } => {
                assert_eq!(field, "mode");
                assert_eq!(needed, 4);
                assert_eq!(available, 1);
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn optional_oid_round_trip() {
        let present = oid_from(0x11);
        let mut writer = FieldWriter::new();
        writer.write_optional_oid(Some(&present));
        writer.write_optional_oid(None);
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(
            reader.read_optional_oid("head").expect("first"),
            Some(present)
        );
        assert_eq!(reader.read_optional_oid("head").expect("second"), None);
    }

    #[test]
    fn oid_round_trip() {
        let sample = oid_from(0x42);
        let mut writer = FieldWriter::new();
        writer.write_oid(&sample);
        let bytes = writer.finish();

        let mut reader = FieldReader::new(&bytes);
        assert_eq!(reader.read_oid("oid").expect("read"), sample);
    }

    #[test]
    fn expect_exhausted_reports_leftover() {
        let payload = [0x01u8, 0x02, 0x03];
        let reader = FieldReader::new(&payload);
        let error = reader
            .expect_exhausted("META")
            .expect_err("leftover must fail");
        match error {
            NativeError::TruncatedRecord { tag, remaining } => {
                assert_eq!(tag, "META");
                assert_eq!(remaining, 3);
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
