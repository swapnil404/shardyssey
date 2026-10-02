import { expect, it } from 'vitest';
import { comparisonModel } from './comparison';
import { parseRecording, planEvidence, replayModel } from './recording';
import baselineJSON from '../public/recordings/demo/fan-out/recording.json';
import delayedJSON from '../public/recordings/demo/slow-branch/recording.json';
const baseline = () => parseRecording(structuredClone(baselineJSON));
const delayed = () => parseRecording(structuredClone(delayedJSON));
it('uses captured query completion as the shared comparison duration', () => {
 expect(comparisonModel(baseline(), delayed()).duration).toBe(501037);
 expect(comparisonModel(baseline(), delayed()).available).toBe(true);
});
it('rejects unrelated and incomplete comparisons', () => {
 const unfinished = delayed(); unfinished.capture_status = 'capturing';
 expect(comparisonModel(baseline(), unfinished).available).toBe(false);
 const unrelated = delayed(); unrelated.query_template = 'SELECT 1';
 expect(comparisonModel(baseline(), unrelated).available).toBe(false);
 const unknown = delayed(); unknown.spans[0].duration_us = null;
 expect(comparisonModel(baseline(), unknown).available).toBe(false);
});
it('explains aggregate behavior only when supported by the captured plan', () => {
 const recorded = delayed(); expect(planEvidence(recorded)?.aggregate).toBe('sum_count_star(0) AS count(*)');
 recorded.explain_runs.find(run => run.format === 'PLAN')!.raw_output = 'JSON\n{"OperatorType":"Aggregate","Variant":"Other"}';
 expect(planEvidence(recorded)).toBeNull();
});
it('rejects missing or duplicated fan-out branches', () => {
 const missing = baseline(); missing.branches.pop(); expect(replayModel(missing).available).toBe(false);
 const duplicate = baseline(); duplicate.branches[1] = duplicate.branches[0]; expect(replayModel(duplicate).available).toBe(false);
});
