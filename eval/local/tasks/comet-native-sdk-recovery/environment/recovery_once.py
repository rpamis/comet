"""Non-repeatable local check: the recovery path must reuse its original receipt."""
from pathlib import Path

counter = Path('.cache/comet-sdk-recovery/check-count')
counter.parent.mkdir(parents=True, exist_ok=True)
with counter.open('x', encoding='utf-8') as output:
    output.write('once\n')
