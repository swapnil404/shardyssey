import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(web, '../fixtures/20261002T152725Z');
const destination = resolve(web, 'public/recordings/demo');
const experiments = ['one-shard', 'fan-out', 'slow-branch'];
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const write = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
};
for (const experiment of experiments) {
const recording = JSON.parse(await readFile(resolve(source, experiment, 'recording.json'), 'utf8'));
if (recording.capture_status !== 'complete' || !recording.timing_available) throw new Error('Cannot bundle an incomplete recording');
await mkdir(resolve(destination, experiment), { recursive: true });
// Bundle only the selected demo execution, without private connection details.
const safeTags = new Set(['service.instance.id', 'otel.scope.name', 'span.kind', 'sql-statement-type', 'method', 'cell', 'keyspace', 'shard', 'isolation-level', 'workload_name', 'active', 'available', 'capacity', 'in_use', 'otel.status_code', 'error']);
for (const [key, relative] of Object.entries(recording.raw_evidence_paths)) {
  const origin = resolve(source, experiment, relative);
  const target = resolve(destination, experiment, relative);
  if (!target.startsWith(destination + '/')) throw new Error('Evidence path escapes bundle');
  if (key.startsWith('topology:')) {
    const tablet = await read(origin);
    await write(target, { alias: tablet.alias, keyspace: tablet.keyspace, shard: tablet.shard, type: tablet.type });
  } else if (key === 'trace') {
    const response = await read(origin);
    if (response.data.length !== 1 || response.data[0].traceID !== recording.trace_id) throw new Error('Unrelated trace in bundle');
    for (const trace of response.data) {
      for (const span of trace.spans) {
        span.tags = span.tags.filter(tag => safeTags.has(tag.key));
        span.logs = []; // This run needs span metadata, not arbitrary log payloads.
      }
      for (const process of Object.values(trace.processes)) process.tags = process.tags.filter(tag => safeTags.has(tag.key));
    }
    await write(target, response);
  } else if (basename(relative).startsWith('fault-')) {
    const text = await readFile(origin, 'utf8');
    await writeFile(target, text.replace(/match [a-f0-9]{8}\/ffffffff at 16/g, 'match [tablet destination redacted] at 16'));
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(origin));
  }
}
// Ensure evidence links in the inspector resolve relative to the recording.
await write(resolve(destination, experiment, 'recording.json'), recording);
}
await write(resolve(web, 'public/experiments.json'), {
  schema_version: 1,
  experiments: experiments.map(id => ({ id, label: {'one-shard': 'One shard', 'fan-out': 'Fan-out', 'slow-branch': 'Slow branch'}[id], recording: `recordings/demo/${id}/recording.json` })),
});
console.log('Bundled real experiment recordings and selected evidence.');

const seed = {};
for (const shard of ['-80', '80-']) {
  const filename = `seed-${shard}.tsv`;
  const raw = await readFile(resolve(source, filename), 'utf8');
  const lines = raw.trim().split('\n');
  if (lines.shift() !== 'user_id\tevent_id\tcategory') throw new Error('Unknown seed columns');
  seed[shard] = lines.map(line => {
    const [user_id, event_id, category] = line.split('\t');
    if (!/^\d+$/.test(user_id) || !/^\d+$/.test(event_id) || !['view', 'click'].includes(category)) throw new Error('Invalid demo seed');
    return {user_id: Number(user_id), event_id: Number(event_id), category};
  });
  await writeFile(resolve(destination, filename), raw);
}
await write(resolve(destination, 'seed.json'), {schema_version: 1, shards: seed});
