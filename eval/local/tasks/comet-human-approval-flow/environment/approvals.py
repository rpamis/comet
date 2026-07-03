from __future__ import annotations


DOCUMENTS = {"a": "Alpha", "b": "Beta"}


def read_document(doc_id: str) -> str | None:
    return DOCUMENTS.get(doc_id)


def delete_document(doc_id: str) -> dict:
    DOCUMENTS.pop(doc_id, None)
    return {"status": "deleted", "doc_id": doc_id}


def approve(approval_id: str) -> dict:
    return {"status": "missing", "approval_id": approval_id}
