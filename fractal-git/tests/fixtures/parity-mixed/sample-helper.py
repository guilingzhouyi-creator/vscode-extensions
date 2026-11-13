"""Fixture Python script for polyglot parity testing."""


def load_text(path):
    """Read text content from file path."""
    try:
        handle = open(path, 'r')
        return handle.read()
    except:
        return ''
