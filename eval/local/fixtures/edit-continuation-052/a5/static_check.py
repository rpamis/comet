"""Optional later syntax/parser checks; never starts product Runtime or models."""

from pathlib import Path
import ast
import json
import subprocess
import tomllib

base = Path(__file__).resolve().parent
checks = []
for file in sorted(base.rglob("*.py")):
    if "logs" not in file.parts:
        ast.parse(file.read_text(encoding="utf-8"), filename=str(file))
        checks.append(str(file.relative_to(base)))
for folder in ("native", "classic"):
    for file in sorted((base / folder).glob("*.mjs")):
        process = subprocess.run(["node", "--check", str(file)], capture_output=True, text=True)
        assert process.returncode == 0, process.stderr
        checks.append(str(file.relative_to(base)))
for file in sorted((base / "tasks").rglob("task.toml")):
    tomllib.loads(file.read_text())
    checks.append(str(file.relative_to(base)))
assert len(list((base / "tasks").glob("*/task.toml"))) == 2, (
    "Assemble both independent A5 tasks first"
)
result = {
    "scope": "Python/JavaScript syntax and task parsing only",
    "checks": checks,
    "RuntimeExecuted": False,
    "modelStarted": False,
}
(base / "static-results.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
