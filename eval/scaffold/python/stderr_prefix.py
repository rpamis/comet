"""Stream provider diagnostics without letting them impersonate loop-control records."""
from __future__ import annotations

import os
import sys


def main():
    output = sys.stdout.buffer
    at_line_start = True
    while chunk := os.read(sys.stdin.fileno(), 4096):
        # splitlines handles CR as well as LF, including a CR/LF split between reads.
        for part in chunk.splitlines(keepends=True):
            if at_line_start:
                output.write(b"[agent-stderr] ")
            output.write(part)
            at_line_start = part.endswith((b"\n", b"\r"))
        output.flush()  # Partial diagnostics must survive a timeout before newline/EOF.
    if not at_line_start:
        output.write(b"\n")  # The next trusted loop record must start on its own line.
        output.flush()


if __name__ == "__main__":
    main()
