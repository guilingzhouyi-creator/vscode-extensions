//! Fixture Rust sample for polyglot parity testing.

pub fn parse_port(raw: Option<u16>) -> u16 {
    let val = raw.unwrap();
    if val == 0 {
        panic!("invalid port");
    }
    val
}
