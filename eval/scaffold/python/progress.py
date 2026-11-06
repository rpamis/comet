"""Non-authoritative execution progress for the local Eval dashboard."""

import json
import os
import re
import subprocess
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4

from scaffold.python.paths import CURRENT_COMET_SNAPSHOT_REF, get_runs_dir
from scaffold.python.execution import redact_sensitive


def candidate_storage_bytes(root: Path) -> int:
    """统计候选中的普通文件；不跟随链接，不重复计入构建输入与产品快照。"""
    total = 0

    def unreadable(error):
        raise error

    for directory, dirs, files in os.walk(root, followlinks=False, onerror=unreadable):
        dirs[:] = [
            name
            for name in dirs
            if (Path(directory) / name).relative_to(root).as_posix()
            not in {".dataset-build", "_eval_current_comet", CURRENT_COMET_SNAPSHOT_REF}
        ]
        for name in files:
            file = Path(directory) / name
            try:
                if not file.is_symlink():
                    total += file.stat().st_size
            except FileNotFoundError:
                continue  # 活动候选允许原子替换文件。
    return total


@contextmanager
def observe_dataset_storage(root: Path | None, container_name: str | None):
    state = {"error": None}
    if root is None or not (root / ".dataset-task.json").is_file():
        yield state
        return
    execution = json.loads((root / ".dataset-task.json").read_text(encoding="utf-8")).get(
        "execution", {}
    )
    limit = execution.get("storageMb")
    if limit is None:
        yield state
        return
    if type(limit) not in (int, float) or limit <= 0:
        raise ValueError("数据集候选存储预算必须为正数")
    stop = threading.Event()

    def check():
        used = candidate_storage_bytes(root)
        if used > limit * 1024 * 1024:
            state["error"] = f"dataset_storage_limit: candidate={used} bytes, limit={limit} MiB"
        return state["error"]

    if check():
        raise ValueError(state["error"])
    state["check"] = check

    def monitor():
        while not stop.wait(2):
            try:
                error = check()
            except OSError:
                state["error"] = "dataset_storage_incomplete: 无法读取候选存储用量"
                error = state["error"]
            if stop.is_set():
                return
            if (
                error
                and container_name
                and re.fullmatch(
                    r"comet-eval-(?:turn|loop|agent-loop|score)-[a-f0-9]{24,32}", container_name
                )
            ):
                try:
                    result = subprocess.run(
                        ["docker", "kill", container_name],
                        capture_output=True,
                        timeout=10,
                        check=False,
                    )
                    if result.returncode == 0:
                        return
                except (OSError, subprocess.TimeoutExpired):
                    pass

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        stop.set()
        thread.join(timeout=12)
        check()


_LOCK = threading.RLock()
_LAST_WRITE = {}
_PHASES = {"preparing", "generating", "running", "judging", "finalizing"}
_PHASE_LABELS = {
    "preparing": "准备评估环境",
    "generating": "生成并固定用例",
    "running": "执行评估用例",
    "judging": "判定用例结果",
    "finalizing": "生成评估报告",
}
_TOOLS = {
    "Bash": "执行命令",
    "Shell": "执行命令",
    "Read": "读取工作区文件",
    "Write": "写入工作区文件",
    "Edit": "修改工作区文件",
    "Grep": "搜索代码内容",
    "Glob": "查找工作区文件",
    "Task": "调用子 Agent",
    "Agent": "调用子 Agent",
    "Skill": "加载 Skill",
}


def _run_root():
    if not os.environ.get("COMET_EVAL_CONTEXT"):
        return None
    if (
        os.environ.get("COMET_EVAL_MANAGED") != "1"
        and os.environ.get("COMET_EVAL_PROGRESS_ENABLED") != "1"
    ):
        return None
    run_id = os.environ.get("COMET_EVAL_EXPERIMENT_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", run_id):
        return None
    try:
        base = get_runs_dir().resolve()
        root = base / run_id
        if root.resolve() != root:
            return None
    except (OSError, ValueError, TypeError):
        return None
    return root


def _update(phase=None, *, case=None, activities=None, event_at=None, force=False):
    temporary = None
    try:
        root = _run_root()
        if root is None:
            return
        with _LOCK:
            now = time.monotonic()
            if not force and now - _LAST_WRITE.get(str(root), 0) < 1:
                return
            root.mkdir(parents=True, exist_ok=True)
            file = root / "progress.json"
            try:
                current = json.loads(file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                current = {}
            run_id = os.environ["COMET_EVAL_EXPERIMENT_ID"]
            if not isinstance(current, dict) or current.get("runId") != run_id:
                current = {}
            if event_at and current.get("lastEventAt") and event_at < current["lastEventAt"]:
                return
            at = datetime.now(timezone.utc).isoformat()
            previous_phase = current.get("phase")
            if phase is None:
                phase = previous_phase if previous_phase in _PHASES else "running"
            history = current.get("activities", [])
            if not isinstance(history, list):
                history = []
            history = [item for item in history if isinstance(item, dict)][-3:]
            if phase != previous_phase:
                history.append(
                    {"id": str(uuid4()), "at": at, "kind": "phase", "message": _PHASE_LABELS[phase]}
                )
            for activity in activities or []:
                if not any(item.get("id") == activity["id"] for item in history):
                    history.append(activity)
            data = {
                "schema": "comet.eval.progress.v1",
                "runId": run_id,
                "phase": phase,
                "updatedAt": at,
                "activities": history[-3:],
            }
            if case is not None or current.get("currentCase") is not None:
                data["currentCase"] = case if case is not None else current["currentCase"]
            if event_at or current.get("lastEventAt"):
                data["lastEventAt"] = event_at or current["lastEventAt"]
            temporary = root / f".progress-{uuid4()}.tmp"
            temporary.write_text(
                json.dumps(redact_sensitive(data), ensure_ascii=False), encoding="utf-8"
            )
            os.replace(temporary, file)
            _LAST_WRITE[str(root)] = now
    except (OSError, ValueError, TypeError, KeyError):
        # 进度失败不能改变执行结果或阻断容器清理。
        pass
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def publish_eval_progress(phase: str, *, task=None, treatment=None, repetition=1) -> None:
    if phase not in _PHASES:
        return
    case = {"task": task, "treatment": treatment, "repetition": repetition} if task else None
    _update(phase, case=case, force=True)


def observe_eval_event(event):
    """只发布调用状态和工具类别，不保存思考、提示词或工具参数。"""
    if not isinstance(event, dict):
        return
    meta = event.get("_comet_eval", {})
    if not isinstance(meta, dict) or meta.get("schema") != "comet.eval.stream-event.v1":
        return
    at = meta.get("observed_at")
    try:
        parsed = datetime.fromisoformat(at)
        if parsed.tzinfo is None:
            return
        at = parsed.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        return
    invocation = meta.get("invocation_id")
    sequence = meta.get("sequence")
    if not isinstance(invocation, str) or not re.fullmatch(r"[\w-]{1,128}", invocation):
        return
    if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
        return
    activities = []
    event_type = event.get("type")
    phase = None
    if event_type == "comet.eval.invocation.started":
        root = _run_root()
        previous_phase = None
        if root:
            try:
                previous_phase = json.loads(
                    (root / "progress.json").read_text(encoding="utf-8")
                ).get("phase")
            except (OSError, ValueError, AttributeError):
                pass
        phase = (
            "judging"
            if meta.get("role") == "judge"
            else "generating"
            if previous_phase == "generating"
            else "running"
        )
        label = "独立判定模型开始处理" if meta.get("role") == "judge" else "模型开始处理"
        activities.append({"kind": "model", "message": label})
    elif event_type == "comet.eval.invocation.completed":
        activities.append({"kind": "model", "message": "本轮模型调用结束"})
    elif event_type == "assistant":
        message = event.get("message", {})
        content = message.get("content", []) if isinstance(message, dict) else []
        if isinstance(content, list):
            for part in content[:64]:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    name = part.get("name")
                    activities.append(
                        {
                            "kind": "tool",
                            "message": _TOOLS.get(name, "调用工具")
                            if isinstance(name, str)
                            else "调用工具",
                        }
                    )
    for index, item in enumerate(activities):
        item.update({"id": f"{invocation}:{sequence}:{index}", "at": at})
    _update(phase, activities=activities, event_at=at, force=bool(activities))


@contextmanager
def observe_eval_container(container_name):
    """旁路读取当前容器的事件；退出时只结束日志客户端。"""
    if (
        not container_name
        or not re.fullmatch(r"comet-eval-(?:turn|loop|agent-loop)-[a-f0-9]{24,32}", container_name)
        or _run_root() is None
    ):
        yield
        return
    stop = threading.Event()
    lock = threading.Lock()
    client = [None]
    since = datetime.now(timezone.utc).isoformat()

    def read_events():
        while not stop.is_set():
            try:
                with lock:
                    if stop.is_set():
                        return
                    process = subprocess.Popen(
                        ["docker", "logs", "--follow", "--since", since, container_name],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    )
                    client[0] = process
                oversized = False
                while not stop.is_set():
                    line = process.stdout.readline(1024 * 1024 + 1)
                    if not line:
                        break
                    if stop.is_set():
                        break
                    if oversized or len(line) > 1024 * 1024:
                        oversized = not line.endswith(b"\n")
                        continue
                    try:
                        observe_eval_event(json.loads(line))
                    except (ValueError, TypeError, OSError):
                        pass
                process.stdout.close()
                process.wait()
            except (OSError, ValueError):
                pass
            finally:
                with lock:
                    client[0] = None
            stop.wait(0.5)

    thread = threading.Thread(target=read_events, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        with lock:
            process = client[0]
            if process is not None and process.poll() is None:
                process.kill()
        thread.join(timeout=2)
