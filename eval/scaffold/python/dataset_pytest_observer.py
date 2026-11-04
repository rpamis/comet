"""记录原题 pytest 的执行状态，不改变其断言、退出码或 reward。"""

import json
import os
from pathlib import Path
from importlib import metadata, machinery


def pytest_load_initial_conftests(early_config, parser, args):
    if os.environ.get("COMET_DATASET_PLUGIN_POLICY") != "root-owned":
        return
    # 自动发现仅限评分镜像或评分时新安装的 root-owned 包。主体可写目录中的
    # distribution 元数据和插件不能因出现在 sys.path 就得到加载权。
    writable = [
        Path(p)
        for p in (
            "/workspace",
            "/root",
            "/app",
            "/data",
            "/outputs",
            "/opt/syzkaller",
            "/home/agent",
        )
    ]
    for entry in metadata.entry_points(group="pytest11"):
        spec = machinery.PathFinder.find_spec(entry.module.split(".", 1)[0])
        if spec is None:
            continue
        locations = (
            [spec.origin]
            if spec.origin and spec.origin not in {"built-in", "frozen"}
            else list(spec.submodule_search_locations or [])
        )
        if not locations:
            continue
        trusted = True
        for location in locations:
            path = Path(location).resolve()
            try:
                info = path.stat()
                trusted = (
                    trusted
                    and info.st_uid == 0
                    and not (info.st_mode & 0o022)
                    and not any(path.is_relative_to(root) for root in writable)
                )
            except OSError:
                trusted = False
        if trusted:
            early_config.pluginmanager.load_setuptools_entrypoints("pytest11", name=entry.name)


def pytest_sessionfinish(session, exitstatus):
    destination = os.environ.get("COMET_DATASET_OBSERVER")
    if not destination:
        return
    reporter = session.config.pluginmanager.getplugin("terminalreporter")
    stats = reporter.stats if reporter is not None else {}
    ran = sum(len(stats.get(key, [])) for key in ("passed", "failed", "xfailed", "xpassed"))
    errors = len(stats.get("error", []))
    plugins = []
    for name, plugin in session.config.pluginmanager.list_name_plugin():
        plugins.extend([str(name), str(getattr(plugin, "__name__", ""))])
    required = json.loads(os.environ.get("COMET_DATASET_REQUIRED_PLUGINS", "[]"))
    missing = [name for name in required if not any(name in value for value in plugins)]
    status = (
        "environment_error"
        if missing or int(exitstatus) in {3, 4}
        else "collection_error"
        if int(exitstatus) == 2
        else "test_error"
        if errors
        else "not_executed"
        if not ran
        else "assertion_failed"
        if int(exitstatus) == 1
        else "completed"
        if int(exitstatus) == 0
        else "unknown"
    )
    record = {
        "status": status,
        "exitCode": int(exitstatus),
        "collected": session.testscollected,
        "ran": ran,
        "errors": errors,
        "missingPlugins": missing,
    }
    with Path(destination).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")
