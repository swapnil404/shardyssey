export type ShardKey = 'tenant_id' | 'user_id';
export type QueryField = ShardKey;
export type EventRow = { event_id: number; tenant_id: number; user_id: number; action: string };
export const tenants = ['Atlas', 'Birch', 'Cedar', 'Dune'];
export const rows: EventRow[] = Array.from({length: 24}, (_, index) => {
  const user = Math.floor(index / 2) + 1;
  return {event_id: index + 1, tenant_id: user <= 6 ? 1 : user <= 9 ? 2 : user <= 11 ? 3 : 4, user_id: user, action: index % 2 ? 'click' : 'view'};
});
// Deliberately simple educational partitioning, not the Vitess hash vindex.
export function shardFor(value: number) { return value % 4; }
export function partitions(key: ShardKey) { return Array.from({length: 4}, (_, shard) => rows.filter(row => shardFor(row[key]) === shard)); }
export function execute(key: ShardKey, field: QueryField, value: number) {
  const contacted = field === key ? [shardFor(value)] : [0, 1, 2, 3];
  const data = partitions(key);
  return {key, field, value, contacted, result: rows.filter(row => row[field] === value), sizes: data.map(part => part.length), examined: contacted.reduce((sum, shard) => sum + data[shard].length, 0)};
}
export type Outcome = ReturnType<typeof execute>;
