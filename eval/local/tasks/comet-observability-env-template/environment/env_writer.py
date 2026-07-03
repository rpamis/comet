from __future__ import annotations

from pathlib import Path


def write_env_example(path: str | Path = ".env.example") -> Path:
    target = Path(path)
    target.write_text(
        "ANTHROPIC_API_KEY=\n"
        "LANGSMITH_API_KEY=\n",
        encoding="utf-8",
    )
    return target


if __name__ == "__main__":
    write_env_example()
