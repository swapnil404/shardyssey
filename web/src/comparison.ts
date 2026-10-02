import { replayModel, type Recording, type ReplayModel } from './recording';
export interface LoadedRecording { recording: Recording; url: string }
export function comparisonModel(baseline: Recording, selected: Recording): ReplayModel {
  const a = replayModel(baseline), b = replayModel(selected);
  const longest = a.duration > b.duration ? a : b;
  const sameTopology = (recording: Recording) => recording.topology_snapshot.tablets.map(tablet => `${tablet.keyspace}/${tablet.shard}/${tablet.alias}`).sort().join(',');
  let reason = a.reason ?? b.reason;
  if (baseline.experiment_id !== 'fan-out' || !['fan-out', 'slow-branch'].includes(selected.experiment_id) || baseline.query_template !== selected.query_template || baseline.vitess_version !== selected.vitess_version || sameTopology(baseline) !== sameTopology(selected) || baseline.fault_configuration !== null) reason = 'These captures do not share the same query, topology, version, and baseline conditions.';
  if (selected.experiment_id === 'slow-branch' && (selected.fault_configuration?.type !== 'injected network delay' || !selected.branches.some(branch => branch.shard === selected.fault_configuration?.shard))) reason = 'The injected delay cannot be matched to a captured branch.';
  return { ...longest, available: reason === null, reason };
}
