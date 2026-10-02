import { describe, expect, it } from 'vitest';
import captured from '../public/recordings/demo/one-shard/recording.json';
import { evidenceURL, intervalState, nextEvent, parseRecording, replayModel, resultVisible } from './recording';
const fixture = () => parseRecording(structuredClone(captured));
describe('real one-shard replay', () => {
  it('uses exact captured boundaries and returns the result only at query completion', () => {
    const model = replayModel(fixture());
    expect(model.available).toBe(true);
    expect(model.duration).toBe(816);
    const branch = model.recording.branches[0];
    const start = branch.start! - model.root!.start!;
    const end = branch.end! - model.root!.start!;
    for (let cursor = 0; cursor <= model.duration; cursor++) {
      expect(intervalState(model, cursor, branch)).toBe(cursor < start ? 'pending' : cursor < end ? 'active' : 'complete');
      expect(resultVisible(model, cursor)).toBe(cursor === model.duration);
    }
    expect(nextEvent(model, 0)).toBe(start);
    expect(nextEvent(model, start)).toBe(end);
    expect(nextEvent(model, end)).toBe(model.duration);
  });
  it.each(['capturing', 'failed', 'incomplete', 'unknown', ''])('never replays a %s capture even if timing is enabled', status => {
    const recording = fixture(); recording.capture_status = status;
    const model = replayModel(recording);
    expect(model.available).toBe(false);
    expect(resultVisible(model, model.duration)).toBe(false);
    expect(intervalState(model, 0, recording.branches[0])).toBe('unavailable');
  });
  it('rejects unknown timing and inconsistent source intervals', () => {
    const missing = fixture(); missing.spans[0].start = null;
    expect(replayModel(missing).available).toBe(false);
    const mismatch = fixture(); mismatch.branches[0].duration_us!++;
    expect(replayModel(mismatch).available).toBe(false);
    const orphan = fixture(); orphan.spans.find(span => span.parent_id !== null)!.parent_id = 'missing';
    expect(replayModel(orphan).available).toBe(false);
  });
  it('rejects unsupported schemas and duplicate spans', () => {
    expect(() => parseRecording({...captured, schema_version: 2})).toThrow();
    expect(() => parseRecording({...captured, spans: [...captured.spans, captured.spans[0]]})).toThrow();
  });
  it('keeps supporting evidence within the bundled recording', () => {
    const url = 'https://example.com/recordings/demo/one-shard/recording.json';
    expect(evidenceURL(url, '../topology.json')).toBe('https://example.com/recordings/demo/topology.json');
    expect(() => evidenceURL(url, '../../../private')).toThrow();
    expect(() => evidenceURL(url, 'https://other.com/file')).toThrow();
  });
});
