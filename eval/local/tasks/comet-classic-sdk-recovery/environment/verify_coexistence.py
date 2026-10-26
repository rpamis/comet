"""Run pytest while observing the excluded proposal before and after the check."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys

PROPOSAL = Path("docs/openspec/changes/parked-format/proposal.md")
EXPECTED = b"# Parked format\nKeep this unrelated formatting request pending.\n"


def observe():
    if any(path.is_symlink() for path in [PROPOSAL, *PROPOSAL.parents]):
        raise ValueError("Parked proposal must be a regular, unlinked file")
    source = PROPOSAL.read_bytes()
    if source != EXPECTED:
        raise ValueError("Parked proposal changed or was removed")
    return {"path": PROPOSAL.as_posix(), "sha256": hashlib.sha256(source).hexdigest()}


def main():
    before = observe()
    result = subprocess.run([sys.executable, "-I", "-m", "pytest", "-q"], check=False)
    after = observe()
    print(
        "COMET_EVAL_COEXISTENCE "
        + json.dumps(
            {
                "schema": "comet.eval.classic-coexistence.v1",
                "before": before,
                "after": after,
                "exitCode": result.returncode,
            }
        ),
        flush=True,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
