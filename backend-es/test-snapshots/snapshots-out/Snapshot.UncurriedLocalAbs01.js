import * as Data$dFoldable from "../Data.Foldable/index.js";
import * as Data$dSemiring from "../Data.Semiring/index.js";
const test = x => y => {
  const fn = a => b => Data$dFoldable.foldlArray(Data$dSemiring.intAdd)(0)([x, a, b, a, b, a, b, a, b, a, b, a, b, a, b, a, b, a, b]);
  return fn(x)(y) + fn(y)(x) | 0;
};
export {test};
