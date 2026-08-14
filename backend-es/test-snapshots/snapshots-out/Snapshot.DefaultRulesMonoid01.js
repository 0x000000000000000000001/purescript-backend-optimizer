import * as Data$dMonoid from "../Data.Monoid/index.js";
const test2 = f => {
  const $0 = Data$dMonoid.guard(Data$dMonoid.monoidArray);
  const $1 = f([1, 2, 3]);
  return a => $0(a)($1);
};
const test1 = /* #__PURE__ */ (() => {
  const $0 = Data$dMonoid.guard(Data$dMonoid.monoidArray);
  return a => $0(a)([1, 2, 3]);
})();
export {test1, test2};
