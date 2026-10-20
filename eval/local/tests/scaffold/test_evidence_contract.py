import json
from pathlib import Path

import pytest

from scaffold.python.evidence_contract import case_identity
from scaffold.python.aligned_comparison import parse_expected_case_matrix


def test_shared_identity_and_matrix_golden():
    golden = json.loads((Path(__file__).resolve().parents[4] / 'config/eval-evidence-golden.json').read_text())
    parsed = parse_expected_case_matrix(golden['matrix'])
    assert len(parsed.cases) == 3
    assert case_identity(golden['valid'], golden['experiment'])['repetition'] == 2
    with pytest.raises(ValueError):
        case_identity(golden['valid'], 'other-experiment')
    broken = {**golden['valid'], 'rep': True}
    with pytest.raises(ValueError):
        case_identity(broken, golden['experiment'])


def test_offline_comparison_rejects_cross_experiment_modern_identity(tmp_path):
    from scaffold.python.aligned_comparison import _report_identity
    golden = json.loads((Path(__file__).resolve().parents[4] / 'config/eval-evidence-golden.json').read_text())
    report = golden['valid']
    assert _report_identity(report, 'BASE', tmp_path / 'golden-run/reports/case_report.json') == ('alpha', 2)
    assert _report_identity(report, 'BASE', tmp_path / 'copied-run/reports/case_report.json') is None
