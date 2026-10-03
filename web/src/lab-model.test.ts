import { expect, it } from 'vitest';
import { execute, partitions, rows, shardFor, type ShardKey } from './lab-model';
it('preserves every event when redistributing, and exposes the skew of the large tenant', () => {
  expect(partitions('tenant_id').map(p => p.length)).toEqual([2, 12, 6, 4]);
  expect(partitions('user_id').map(p => p.length)).toEqual([6, 6, 6, 6]);
  for (const key of ['tenant_id', 'user_id'] as ShardKey[]) {
    const events = partitions(key).flat().map(r => r.event_id).sort((a,b) => a-b);
    expect(events).toEqual(rows.map(r => r.event_id));
  }
});
it('returns identical tenant rows while changing one shard lookup into fan-out', () => {
  const byTenant = execute('tenant_id', 'tenant_id', 1);
  const byUser = execute('user_id', 'tenant_id', 1);
  expect(byTenant.contacted).toEqual([1]);
  expect(byUser.contacted).toEqual([0,1,2,3]);
  expect(byTenant.result).toEqual(byUser.result);
  expect(byTenant.result).toHaveLength(12);
  expect(byTenant.examined).toBe(12);
  expect(byUser.examined).toBe(24);
});
it('routes every supported lookup to all shards that can hold a matching event', () => {
  for (const key of ['tenant_id', 'user_id'] as ShardKey[]) {
    for (const field of ['tenant_id', 'user_id'] as ShardKey[]) {
      for (let value=1; value <= (field === 'tenant_id' ? 4 : 12); value++) {
        const outcome = execute(key, field, value);
        expect(outcome.result.length).toBeGreaterThan(0);
        for (const row of outcome.result) expect(outcome.contacted).toContain(shardFor(row[key]));
      }
    }
  }
});
