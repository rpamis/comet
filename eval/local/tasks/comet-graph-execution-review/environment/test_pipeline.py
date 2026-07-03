import pipeline


def setup_function():
    pipeline.THREADS.clear()


def test_fan_out_processes_every_task_without_review():
    result = pipeline.run_pipeline(
        ["alpha", "beta", "gamma"],
        thread_id="fanout",
        require_review=False,
    )

    assert result["status"] == "finalized"
    assert len(result["results"]) == 3
    assert "alpha" in " ".join(result["results"])
    assert "beta" in " ".join(result["results"])
    assert "gamma" in " ".join(result["results"])


def test_multi_task_run_interrupts_for_review_before_summary():
    result = pipeline.run_pipeline(["draft", "verify"], thread_id="review")

    assert "__interrupt__" in result
    assert result["status"] == "waiting_for_review"
    assert not result.get("summary")


def test_resume_after_review_continues_same_thread():
    first = pipeline.run_pipeline(["extract", "transform", "load"], thread_id="resume")

    assert "__interrupt__" in first

    resumed = pipeline.resume_after_review(thread_id="resume")

    assert resumed["status"] == "approved"
    assert len(resumed["results"]) == 3
    assert "3" in resumed["summary"]
    assert "extract" in " ".join(resumed["results"])


def test_thread_state_is_isolated_by_thread_id():
    pipeline.run_pipeline(["a1", "a2"], thread_id="thread-a")
    pipeline.run_pipeline(["b1", "b2", "b3"], thread_id="thread-b")

    resumed_a = pipeline.resume_after_review(thread_id="thread-a")
    resumed_b = pipeline.resume_after_review(thread_id="thread-b")

    assert len(resumed_a["results"]) == 2
    assert len(resumed_b["results"]) == 3
    assert "a1" in " ".join(resumed_a["results"])
    assert "b1" in " ".join(resumed_b["results"])
