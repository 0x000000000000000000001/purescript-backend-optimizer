import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve(process.argv[2]);
const [M, N, Ord, U] = await Promise.all(['Data.Map', 'PureScript.Backend.Optimizer.NativeMaps', 'Data.Ord', 'Data.Unfoldable']
  .map(name => import(pathToFileURL(resolve(output, name, 'index.js')))));
const insert = M.insert(Ord.ordInt), entries = M.toUnfoldable(U.unfoldableArray);
let checks = 0;
for (const count of [0, 1, 2, 17, 255, 4096]) {
  let map = M.empty;
  for (let i = 0; i < count; i++) { const key = (i * 37) % count - Math.floor(count / 2); map = insert(key)(key * 3)(map); }
  const before = entries(map);
  for (const lower of [-2147483648, -count, -Math.floor(count / 2), -1, 0, 1, Math.floor(count / 2), count, 2147483647]) {
    const seen = [];
    const result = N.foldrIntSuffix(lower)(value => acc => { seen.push(value); return [value, ...acc]; })(['seed'])(map);
    const expected = before.filter(item => item.value0 >= lower).map(item => item.value1);
    assert.deepEqual(result, [...expected, 'seed']); assert.deepEqual(seen, expected.toReversed());
    assert.deepEqual(entries(map), before); checks++;
  }
}
console.log(`JS integer suffix: ${checks} exact boundary/order/persistence cases passed`);
