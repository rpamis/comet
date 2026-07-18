"""Validate Native Dashboard projection parity and read-only collection."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from pathlib import PurePosixPath

import yaml

from scaffold.python.validation.native_wave import (
    active_changes,
    archive_changes,
    check_dashboard_projection,
    check_native_isolation,
    check_pytest,
    check_runtime_envelopes,
    failed,
    passed,
    read_json,
    write_results,
)


WORKSPACE = Path("/workspace")
EVIDENCE = Path(".cache/comet-native-eval")
HASH = re.compile(r"^[a-f0-9]{64}$")

NATIVE_KEYS = {
    "schema",
    "generatedAt",
    "totalChangeCount",
    "visibleChangeCount",
    "omittedChangeCount",
    "changesTruncated",
    "changes",
    "conflicts",
}
CHANGE_KEYS = {
    "workflow",
    "name",
    "phase",
    "revision",
    "selected",
    "nextCommand",
    "verificationResult",
    "verificationFreshness",
    "archiveReady",
    "continuation",
    "findings",
    "archive",
    "conflicts",
}
FORBIDDEN_NATIVE_KEYS = {
    "path",
    "paths",
    "projectRoot",
    "nativeRoot",
    "archiveDir",
    "report",
    "verificationReport",
    "verificationEvidence",
    "implementationScope",
    "operations",
    "signals",
    "signalHashes",
    "workspaceIdentityHash",
    "worktreeId",
    "commonDirId",
    "sessionHash",
    "message",
    "reasons",
}

BUILD_IDENTITY_KEYS = {
    "schema",
    "sourceHash",
    "sourceFileCount",
    "snapshotHash",
    "snapshotFileCount",
    "packageHash",
    "entryHash",
    "nativeAdapterHash",
    "compilerVersion",
}


def _real_tree_files(root: Path) -> list[Path]:
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Tree root is not a real directory: {root}")
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Tree contains a symbolic link: {path}")
        if path.is_file():
            files.append(path)
    return files


def _tree_digest(root: Path, files: list[Path]) -> tuple[str, int]:
    digest = hashlib.sha256()
    for path in sorted(files):
        relative = path.relative_to(root).as_posix()
        payload = path.read_bytes()
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(payload)).encode("ascii"))
        digest.update(b"\0")
        digest.update(hashlib.sha256(payload).hexdigest().encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest(), len(files)


def check_current_cli_build_identity() -> dict[str, str]:
    check = "current_cli_source_build"
    snapshot = WORKSPACE / "_eval_current_comet"
    try:
        identity_path = snapshot / "build-identity.json"
        if identity_path.is_symlink() or not identity_path.is_file():
            raise ValueError("Controller source-build identity is missing")
        identity = read_json(identity_path)
        if not isinstance(identity, dict) or set(identity) != BUILD_IDENTITY_KEYS:
            raise ValueError("Controller source-build identity fields are invalid")
        if identity["schema"] != "comet.eval.current-comet-build.v1":
            raise ValueError("Controller source-build identity schema is invalid")
        for field in (
            "sourceHash",
            "snapshotHash",
            "packageHash",
            "entryHash",
            "nativeAdapterHash",
        ):
            if not isinstance(identity[field], str) or not HASH.fullmatch(identity[field]):
                raise ValueError(f"Controller source-build {field} is invalid")
        for field in ("sourceFileCount", "snapshotFileCount"):
            if (
                isinstance(identity[field], bool)
                or not isinstance(identity[field], int)
                or identity[field] < 1
            ):
                raise ValueError(f"Controller source-build {field} is invalid")
        if not isinstance(identity["compilerVersion"], str) or not identity["compilerVersion"]:
            raise ValueError("Controller source-build compiler version is invalid")
        entry = snapshot / "dist/app/cli/index.js"
        adapter = snapshot / "dist/domains/dashboard/native-adapter.js"
        package = snapshot / "package.json"
        for path in (entry, adapter, package, snapshot / "bin/comet.js"):
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Controller source build omitted a real file: {path}")
        files = [
            path for relative in ("bin", "dist") for path in _real_tree_files(snapshot / relative)
        ] + [package]
        snapshot_hash, snapshot_count = _tree_digest(snapshot, files)
        if (
            snapshot_hash != identity["snapshotHash"]
            or snapshot_count != identity["snapshotFileCount"]
        ):
            raise ValueError("Controller source-build snapshot identity does not match its files")
        bindings = {
            package: "packageHash",
            entry: "entryHash",
            adapter: "nativeAdapterHash",
        }
        for path, field in bindings.items():
            if hashlib.sha256(path.read_bytes()).hexdigest() != identity[field]:
                raise ValueError(f"Controller source-build {field} does not match {path.name}")
    except Exception as error:
        return failed(check, str(error))
    return passed(check)


def _walk(value):
    yield value
    if isinstance(value, dict):
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def check_public_native_projection() -> dict[str, str]:
    check = "public_native_projection"
    try:
        dashboard = read_json(WORKSPACE / EVIDENCE / "dashboard.json")
        cli = read_json(WORKSPACE / EVIDENCE / "cli-after.json")
    except Exception as error:
        return failed(check, f"Invalid Dashboard or CLI JSON: {error}")
    native = dashboard.get("native") if isinstance(dashboard, dict) else None
    if not isinstance(native, dict) or set(native) != NATIVE_KEYS:
        return failed(
            check, f"Dashboard native root fields are not bounded: {sorted(native or {})}"
        )
    if native.get("schema") != "comet.dashboard.native.v1":
        return failed(check, "Dashboard Native schema is missing")
    changes = native.get("changes")
    if not isinstance(changes, list) or len(changes) != 1 or not isinstance(changes[0], dict):
        return failed(check, "Dashboard must expose exactly one bounded Native change")
    change = changes[0]
    if set(change) != CHANGE_KEYS:
        return failed(check, f"Dashboard Native change fields are not bounded: {sorted(change)}")
    cli_data = cli.get("data") if isinstance(cli, dict) else None
    if not isinstance(cli_data, dict):
        return failed(check, "CLI status envelope has no structured data")
    if (
        change.get("workflow") != "native"
        or change.get("name") != cli_data.get("name")
        or change.get("phase") != cli_data.get("phase")
        or change.get("revision") != cli_data.get("revision")
        or change.get("nextCommand") != cli_data.get("nextCommand")
        or change.get("verificationResult") != cli_data.get("verificationResult")
        or change.get("archiveReady") != cli_data.get("archiveReady")
    ):
        return failed(check, "Dashboard Native projection differs from the Runtime status")
    if not isinstance(change.get("continuation"), dict):
        return failed(check, "Dashboard omitted the bounded Native continuation")
    if not isinstance(change.get("findings"), dict) or not isinstance(change.get("archive"), dict):
        return failed(check, "Dashboard omitted finding or Archive summaries")

    leaked = set()
    path_values = []
    for item in _walk(native):
        if isinstance(item, dict):
            leaked.update(FORBIDDEN_NATIVE_KEYS.intersection(item))
        elif isinstance(item, str) and (
            "/workspace" in item or "docs/comet" in item or "docs\\comet" in item
        ):
            path_values.append(item)
    if leaked or path_values:
        return failed(
            check,
            f"Dashboard exposed raw Native details: fields={sorted(leaked)}, paths={path_values[:3]}",
        )
    return passed(check)


def check_dashboard_readonly() -> dict[str, str]:
    check = "dashboard_readonly"
    evidence = WORKSPACE / EVIDENCE
    before = evidence / "cli-before.json"
    after = evidence / "cli-after.json"
    dashboard = evidence / "dashboard.json"
    comparisons = [
        check_dashboard_projection(before, dashboard),
        check_dashboard_projection(after, dashboard),
        check_dashboard_projection(before, after, comparison_dashboard=False),
    ]
    for comparison in comparisons:
        if comparison["status"] != "passed":
            return failed(check, comparison.get("reason", "Native projections differ"))

    before_tree = evidence / "native-tree-before.json"
    after_tree = evidence / "native-tree-after.json"
    if not before_tree.is_file() or not after_tree.is_file():
        return failed(check, "Native tree manifests are missing")
    try:
        before_manifest = _manifest_files(read_json(before_tree))
        after_manifest = _manifest_files(read_json(after_tree))
        if before_manifest is None or after_manifest is None:
            return failed(check, "Native tree manifests are not canonical SHA-256 maps")
        if before_manifest != after_manifest:
            return failed(check, "Dashboard collection modified the Native artifact tree")
        if after_manifest != _current_native_manifest():
            return failed(check, "Recorded Native tree manifests do not match live files")
    except Exception as error:
        return failed(check, f"Invalid Native tree manifest: {error}")
    return passed(check)


def check_active_projection_source() -> dict[str, str]:
    check = "active_projection_source"
    active = [path.name for path in active_changes(WORKSPACE)]
    if active != ["dashboard-visible-change"]:
        return failed(check, f"Expected one active Dashboard change, found {active}")
    if archive_changes(WORKSPACE):
        return failed(check, "Dashboard fixture change must not be archived")
    change_root = WORKSPACE / "docs/comet/changes/dashboard-visible-change"
    state_file = change_root / "comet-state.yaml"
    spec_file = change_root / "specs/dashboard-visible-change/spec.md"
    if not state_file.is_file() or not spec_file.is_file():
        return failed(check, "The live Native change or target specification is missing")
    try:
        state = yaml.safe_load(state_file.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as error:
        return failed(check, f"Invalid live Native state: {error}")
    if state.get("name") != "dashboard-visible-change" or state.get("phase") != "shape":
        return failed(check, f"Unexpected live Native state: {state}")
    if not spec_file.read_text(encoding="utf-8").strip():
        return failed(check, "The live target specification is empty")
    return passed(check)


def _manifest_files(payload) -> dict[str, str] | None:
    if not isinstance(payload, dict):
        return None
    files = payload.get("files", payload)
    if not isinstance(files, dict):
        return None
    if not all(
        isinstance(key, str)
        and isinstance(value, str)
        and HASH.fullmatch(value.lower())
        and not PurePosixPath(key.replace("\\", "/")).is_absolute()
        and ".." not in PurePosixPath(key.replace("\\", "/")).parts
        for key, value in files.items()
    ):
        return None
    normalized = {key.replace("\\", "/"): value.lower() for key, value in files.items()}
    return normalized if list(normalized) == sorted(normalized) else None


def _current_native_manifest(project_root: Path | None = None) -> dict[str, str]:
    project_root = project_root or WORKSPACE
    root = project_root / "docs/comet"
    return {
        str(path.relative_to(root)).replace("\\", "/"): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in _real_tree_files(root)
    }


def _run_live_dashboard(snapshot: Path, project_root: Path) -> dict:
    node = shutil.which("node")
    cli = snapshot / "bin/comet.js"
    if not node:
        raise RuntimeError("Node.js is unavailable to the current Dashboard validator")
    if snapshot.is_symlink() or not snapshot.is_dir() or cli.is_symlink() or not cli.is_file():
        raise RuntimeError("The controller-built current Comet snapshot is unavailable")
    try:
        with tempfile.TemporaryDirectory(prefix="comet-dashboard-oracle-") as temporary:
            runtime = Path(temporary) / "current-comet"
            shutil.copytree(snapshot, runtime)
            dependencies = Path("/opt/comet-cli/node_modules")
            if dependencies.is_dir():
                (runtime / "node_modules").symlink_to(dependencies, target_is_directory=True)
            result = subprocess.run(
                [node, str(runtime / "bin/comet.js"), "dashboard", str(project_root), "--json"],
                cwd=WORKSPACE,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
    except Exception as error:
        raise RuntimeError(f"Unable to execute the current Dashboard CLI: {error}") from error
    if result.returncode != 0:
        raise RuntimeError(f"Current Dashboard CLI failed: {result.stderr.strip()}")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Current Dashboard CLI emitted invalid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Current Dashboard CLI did not emit a JSON object")
    return payload


def _copy_readonly_probe(source_project: Path, destination: Path) -> None:
    source_native = source_project / "docs/comet"
    _current_native_manifest(source_project)
    (destination / "docs").mkdir(parents=True)
    shutil.copytree(source_native, destination / "docs/comet")
    config = source_project / ".comet/config.yaml"
    if not config.is_file() or config.is_symlink():
        raise ValueError("Native project config is missing from the probe source")
    (destination / ".comet").mkdir()
    shutil.copy2(config, destination / ".comet/config.yaml")
    for path in sorted(destination.rglob("*"), reverse=True):
        if path.is_file():
            path.chmod(0o444)
        elif path.is_dir():
            path.chmod(0o555)
    destination.chmod(0o555)


def _restore_probe_permissions(root: Path) -> None:
    if not root.exists():
        return
    root.chmod(0o755)
    for path in root.rglob("*"):
        try:
            path.chmod(0o755 if path.is_dir() else 0o644)
        except OSError:
            pass


def check_live_dashboard_and_tree() -> dict[str, str]:
    check = "live_dashboard_and_tree"
    snapshot = WORKSPACE / "_eval_current_comet"
    cli = snapshot / "bin/comet.js"
    if snapshot.is_symlink() or not snapshot.is_dir() or cli.is_symlink() or not cli.is_file():
        return failed(check, "The current-checkout Comet CLI fixture was not injected")

    try:
        live_before = _current_native_manifest()
        live_payload = _run_live_dashboard(snapshot, WORKSPACE)
        live_after = _current_native_manifest()
        if live_before != live_after:
            return failed(check, "The source-built Dashboard modified the live Native tree")
        for index in range(2):
            probe = Path(tempfile.mkdtemp(prefix=f"comet-dashboard-readonly-{index}-"))
            try:
                _copy_readonly_probe(WORKSPACE, probe)
                before = _current_native_manifest(probe)
                probe_payload = _run_live_dashboard(snapshot, probe)
                after = _current_native_manifest(probe)
                if before != after:
                    return failed(
                        check,
                        f"The source-built Dashboard modified fresh read-only probe {index + 1}",
                    )
                probe_path = WORKSPACE / EVIDENCE / f"_validator-probe-dashboard-{index}.json"
                probe_path.write_text(json.dumps(probe_payload, indent=2), encoding="utf-8")
                projection = check_dashboard_projection(
                    WORKSPACE / EVIDENCE / "cli-after.json",
                    probe_path,
                )
                if projection["status"] != "passed":
                    return failed(
                        check,
                        projection.get("reason", "Fresh-probe Dashboard projection differs"),
                    )
            finally:
                _restore_probe_permissions(probe)
                shutil.rmtree(probe, ignore_errors=True)
    except Exception as error:
        return failed(check, str(error))

    live_path = WORKSPACE / EVIDENCE / "_validator-live-dashboard.json"
    live_path.write_text(json.dumps(live_payload, indent=2), encoding="utf-8")
    projection = check_dashboard_projection(
        WORKSPACE / EVIDENCE / "cli-after.json",
        live_path,
    )
    if projection["status"] != "passed":
        return failed(check, projection.get("reason", "Live Dashboard projection differs"))

    try:
        recorded = _manifest_files(read_json(WORKSPACE / EVIDENCE / "native-tree-after.json"))
    except Exception as error:
        return failed(check, f"Unable to read the final Native tree manifest: {error}")
    actual = _current_native_manifest()
    if recorded is None or recorded != actual:
        return failed(check, "The recorded tree manifest does not match live Native files")
    return passed(check)


def main() -> int:
    evidence = WORKSPACE / EVIDENCE
    results = [
        check_pytest(WORKSPACE),
        check_current_cli_build_identity(),
        check_runtime_envelopes([evidence / "cli-before.json", evidence / "cli-after.json"]),
        check_dashboard_readonly(),
        check_public_native_projection(),
        check_active_projection_source(),
        check_live_dashboard_and_tree(),
        check_native_isolation(WORKSPACE),
    ]
    return write_results(results, WORKSPACE)


if __name__ == "__main__":
    raise SystemExit(main())
