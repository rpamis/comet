THREADS = {}


def _process(task: str) -> str:
    return f"processed:{task}"


def run_pipeline(tasks, thread_id="default", require_review=True):
    selected = list(tasks)[:1]
    results = [_process(task) for task in selected]
    summary = f"finalized {len(results)} task(s)"
    THREADS[thread_id] = {"tasks": selected, "results": results, "status": "finalized"}
    return {"status": "finalized", "results": results, "summary": summary}


def resume_after_review(thread_id="default"):
    state = THREADS.get(thread_id, {"tasks": [], "results": []})
    THREADS[thread_id] = {"tasks": [], "results": [], "status": "approved"}
    return {"status": "approved", "results": [], "summary": "approved 0 task(s)"}
