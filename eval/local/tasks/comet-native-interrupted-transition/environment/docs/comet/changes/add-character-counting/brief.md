# Outcome
Add character counting to wordcount-cli.
# Scope
Add a --characters CLI flag and preserve existing counters.
# Non-goals
No encoding conversion or grapheme counting.
# Acceptance examples
- Input `abc` prints `Characters: 3`.
- Whitespace and newline characters are included.
# Constraints and invariants
Keep existing word and line output stable.
# Decisions
Count Python input string characters exactly as received.
# Open questions

# Verification expectations
Run focused CLI tests and the full Python test suite.
