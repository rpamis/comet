import pytest

import pipeline


def setup_function():
    pipeline.THREADS.clear()


def test_empty_submission_finalizes_immediately_even_with_review():
    result = pipeline.run_pipeline([], thread_id="empty", require_review=True)

    assert result["status"] == "finalized"
    assert "__interrupt__" not in result
    assert result["summary"] == "finalized 0 task(s)"


def test_single_task_reviewed_run_also_pauses():
    result = pipeline.run_pipeline(["solo"], thread_id="single")

    assert result["status"] == "waiting_for_review"
    assert "__interrupt__" in result
    assert not result.get("summary")


def test_interrupt_payload_is_self_describing():
    result = pipeline.run_pipeline(["draft", "verify"], thread_id="payload")

    payload = result["__interrupt__"]
    assert payload["reason"] == "human_review"
    assert payload["thread_id"] == "payload"
    assert payload["tasks"] == ["draft", "verify"]


def test_resume_unknown_thread_fails_loudly():
    with pytest.raises(KeyError):
        pipeline.resume_after_review(thread_id="never-submitted")


def test_repeated_resume_returns_the_same_results():
    pipeline.run_pipeline(["one", "two"], thread_id="again")

    first = pipeline.resume_after_review(thread_id="again")
    second = pipeline.resume_after_review(thread_id="again")

    assert first == second
    assert first["status"] == "approved"
    assert len(first["results"]) == 2


def test_resume_order_across_threads_does_not_change_outcomes():
    pipeline.run_pipeline(["p1", "p2"], thread_id="order-a")
    pipeline.run_pipeline(["q1", "q2", "q3"], thread_id="order-b")

    resumed_b = pipeline.resume_after_review(thread_id="order-b")
    resumed_a = pipeline.resume_after_review(thread_id="order-a")

    assert len(resumed_a["results"]) == 2
    assert len(resumed_b["results"]) == 3
    assert "p1" in " ".join(resumed_a["results"])
    assert "q1" in " ".join(resumed_b["results"])


def test_mutating_returned_results_does_not_corrupt_stored_state():
    pipeline.run_pipeline(["m1", "m2"], thread_id="mutate")

    first = pipeline.resume_after_review(thread_id="mutate")
    first["results"].append("processed:rogue")

    second = pipeline.resume_after_review(thread_id="mutate")
    assert second["results"] == ["processed:m1", "processed:m2"]


def test_new_run_on_existing_thread_overwrites_its_state():
    pipeline.run_pipeline(["old-a", "old-b"], thread_id="rerun")
    pipeline.run_pipeline(["new-a", "new-b", "new-c"], thread_id="rerun")

    resumed = pipeline.resume_after_review(thread_id="rerun")

    assert len(resumed["results"]) == 3
    assert "new-a" in " ".join(resumed["results"])
    assert "old-a" not in " ".join(resumed["results"])


def test_results_are_stored_before_pause_and_state_stays_inspectable():
    pipeline.run_pipeline(["x", "y"], thread_id="inspect")

    waiting = pipeline.THREADS["inspect"]
    assert waiting["status"] == "waiting_for_review"
    assert waiting["tasks"] == ["x", "y"]
    assert waiting["results"] == ["processed:x", "processed:y"]

    pipeline.resume_after_review(thread_id="inspect")

    approved = pipeline.THREADS["inspect"]
    assert approved["status"] == "approved"
    assert approved["results"] == ["processed:x", "processed:y"]
