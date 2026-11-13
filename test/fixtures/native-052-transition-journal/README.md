# Published 0.5.2 transition journal

Frozen through the published `createNativeChange(legacy-v1)` and `advanceNativeChange` APIs, after an explicitly simulated Shape approval and a fault in `afterPrepared`. The original Shape state and real pending Shape → Build journal are unchanged. The previous Run and checkpoint were genuinely absent before this first transition; the journal contains the original planned Run. Current tests materialize the business records and exercise the retained journal reader. No old execution engine is shipped or loaded by the tests. No model or Eval was run.
