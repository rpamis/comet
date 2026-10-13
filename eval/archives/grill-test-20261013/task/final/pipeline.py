THREADS = {}


def _process(task: str) -> str:
    return f"processed:{task}"


def _store_thread(thread_id, tasks, results, status):
    THREADS[thread_id] = {"tasks": tasks, "results": results, "status": status}


def run_pipeline(tasks, thread_id="default", require_review=True):
    task_list = list(tasks)
    results = [_process(task) for task in task_list]
    if require_review and task_list:
        _store_thread(thread_id, task_list, results, "waiting_for_review")
        return {
            "status": "waiting_for_review",
            "__interrupt__": {
                "reason": "human_review",
                "thread_id": thread_id,
                "tasks": task_list,
            },
        }
    summary = f"finalized {len(results)} task(s)"
    _store_thread(thread_id, task_list, results, "finalized")
    return {"status": "finalized", "results": results, "summary": summary}


def resume_after_review(thread_id="default"):
    state = THREADS[thread_id]
    results = list(state["results"])
    state["status"] = "approved"
    return {
        "status": "approved",
        "results": results,
        "summary": f"approved {len(results)} task(s)",
    }
