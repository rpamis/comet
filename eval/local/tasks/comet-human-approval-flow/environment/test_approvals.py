from __future__ import annotations

import approvals


def setup_function():
    approvals.DOCUMENTS.clear()
    approvals.DOCUMENTS.update({"a": "Alpha", "b": "Beta"})
    if hasattr(approvals, "PENDING_APPROVALS"):
        approvals.PENDING_APPROVALS.clear()


def test_delete_returns_pending_approval_without_deleting():
    result = approvals.delete_document("a")
    assert result["status"] == "pending_approval"
    assert result["doc_id"] == "a"
    assert "approval_id" in result
    assert approvals.read_document("a") == "Alpha"


def test_approve_executes_pending_delete_once():
    pending = approvals.delete_document("a")
    approved = approvals.approve(pending["approval_id"])
    assert approved == {"status": "deleted", "doc_id": "a"}
    assert approvals.read_document("a") is None
    assert approvals.approve(pending["approval_id"])["status"] == "missing"


def test_read_stays_immediate():
    assert approvals.read_document("b") == "Beta"
