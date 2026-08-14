import * as $runtime from "../runtime.js";
import * as Foreign$dObject from "../Foreign.Object/index.js";
const diffWithKeyAndIxE = (o1, $0, $1, $2, $3, $4) => {
  const o2 = {};
  for (const i of $runtime.range(0, $0.length)) {
    const a = $0[i];
    const k = $1(a);
    if (Foreign$dObject.member(k)(o1)) {
      const v2 = $2(k, i, o1[k], a);
      (() => {
        o2[k] = v2;
        return o2;
      })();
      continue;
    }
    const v2 = $4(k, i, a);
    (() => {
      o2[k] = v2;
      return o2;
    })();
  }
  for (const k of Object.keys(o1)) {
    if (Foreign$dObject.member(k)(o2)) { continue; }
    $3(k, o1[k]);
  }
  return o2;
};
const diffWithIxE = (a1, $0, $1, $2, $3) => {
  const a3 = [];
  const l1 = a1.length;
  const l2 = $0.length;
  for (const i of $runtime.range(0, l1 < l2 ? l2 : l1)) {
    if (i < l1) {
      if (i < l2) {
        const v3 = $1(i, a1[i], $0[i]);
        a3.push(v3);
        continue;
      }
      $2(i, a1[i]);
      continue;
    }
    if (i < l2) {
      const v3 = $3(i, $0[i]);
      a3.push(v3);
    }
  }
  return a3;
};
export {diffWithIxE, diffWithKeyAndIxE};
