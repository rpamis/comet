# Experiment Results Summary

**Experiment ID:** `grill-test-faithful-graph-one-shot-20261013`

**Started:** 2026-10-13T14:29:28.912838

**Completed:** 2026-10-13T14:47:37.572843


## Results

| Treatment | Checks | completion | skill_invocation | artifact_presence | instruction_following | interaction_compliance | efficiency | safety_boundary | main_flow | gate_guard | spec_drift | business_completion | workflow_completion | decision_point_compliance | artifact_quality | recovery_resilience | generated_package | resolved_skill_evidence | engine_contract | workflow_route_conformance | authoring_lanes | review_gate | review_readiness | weighted_score | RubricAvg | Turns | Duration | Tools | Tokens | Cost |
|-----------|--------|------------|------------------|-------------------|-----------------------|------------------------|------------|-----------------|-----------|------------|------------|---------------------|---------------------|---------------------------|------------------|---------------------|-------------------|-------------------------|-----------------|----------------------------|-----------------|-------------|------------------|----------------|-----------|-------|----------|-------|--------|------|
| comet-graph-execution-review-DYNAMIC_SKILL-r1 | 9/12 (75%) | 0.00 | / | / | 1.00 | 1.00 | 0.67 | 1.00 | / | / | / | / | / | / | / | / | / | / | / | / | / | / | / | 0.61 | 0.73 | 53 | 901s | 49 | 1,577,847 | $1.6063 |

## Summary

- **Total Runs:** 1
- **Checks Passed:** 9/12 (75.0%)

## Treatment Details

### comet-graph-execution-review-DYNAMIC_SKILL-r1 (9/12 checks, 75%)

**Result:** 9/12 checks (75%) (run_id: aed84565-77e8-4a6b-9d2a-24365991c0fe)
- Metrics: Turns: 53, Duration: 901s, Tool calls: 49, Tokens: 1,577,847, Cost: $1.6063
- Skills invoked: grill-test, grilling
- Passed checks (9):
  - [RUBRIC] completion: 0.00 - 0/2 baseline checks passed
  - [RUBRIC] skill_invocation: N/A - N/A - no required_skills configured
  - [RUBRIC] artifact_presence: N/A - N/A - no expected_artifacts configured
  - [RUBRIC] instruction_following: 1.00 - no explicit constraint failures
  - [RUBRIC] interaction_compliance: 1.00 - turns=0, max=12
  - [RUBRIC] efficiency: 0.67 - turns=53 tools=49 dur=901s
  - [RUBRIC] safety_boundary: 1.00 - no dangerous command pattern observed
  - [RUBRIC] weighted_score: 0.61
  - [RUBRIC-JUDGE] status: failed - [WinError 1920] 系统无法访问此文件。: 'D:\\Project\\Comet\\.comet\\experiments\\grill-test-final\\benchmark\\workspace-subject\\test_task_treatment_comet_grap0\\.claude\\skills\\node_modules\\@rpamis\\comet'
- Failed checks (3):
  - graph_execution_review: e_after_review(thread_id="thread-b")
    
>       assert len(resumed_a["results"]) == 2
E       assert 0 == 2
E        +  where 0 = len([])

test_pipeline.py:50: AssertionError
=========================== short test summary info ============================
FAILED test_pipeline.py::test_fan_out_processes_every_task_without_review - A...
FAILED test_pipeline.py::test_multi_task_run_interrupts_for_review_before_summary
FAILED test_pipeline.py::test_resume_after_review_continues_same_thread - Ass...
FAILED test_pipeline.py::test_thread_state_is_isolated_by_thread_id - assert ...
4 failed in 0.09s
  - SDK evidence rejected: Retained SDK Store failed validation
  - Agent execution failed with exit code 124
