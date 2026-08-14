// @inline export testArrayIndex never
import * as $runtime from "../runtime.js";
import * as Data$dMaybe from "../Data.Maybe/index.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Effect$dException from "../Effect.Exception/index.js";
const showMaybe = {
  show: v => {
    if (v.tag === "Just") { return "(Just " + Data$dShow.showIntImpl(v._1) + ")"; }
    if (v.tag === "Nothing") { return "Nothing"; }
    $runtime.fail();
  }
};
const testArrayIndex = arr => ix => {
  if (ix >= 0 && ix < arr.length) { return Data$dMaybe.$Maybe("Just", arr[ix]); }
  return Data$dMaybe.Nothing;
};
const main = /* #__PURE__ */ (() => {
  const $0 = {expected: Data$dMaybe.Nothing, actual: testArrayIndex([1, 2, 3])(-1)};
  const $1 = $0.actual.tag === "Nothing"
    ? (() => {})
    : Effect$dException.throwException(Effect$dException.error("index -1\nExpected: " + showMaybe.show($0.expected) + "\nActual:   " + showMaybe.show($0.actual)));
  return () => {
    $1();
    const $2 = {expected: Data$dMaybe.$Maybe("Just", 1), actual: testArrayIndex([1, 2, 3])(0)};
    if ($2.actual.tag === "Just" && $2.expected._1 === $2.actual._1) {

    } else {
      Effect$dException.throwException(Effect$dException.error("index 0\nExpected: " + showMaybe.show($2.expected) + "\nActual:   " + showMaybe.show($2.actual)))();
    }
    const $3 = {expected: Data$dMaybe.$Maybe("Just", 2), actual: testArrayIndex([1, 2, 3])(1)};
    if ($3.actual.tag === "Just" && $3.expected._1 === $3.actual._1) {

    } else {
      Effect$dException.throwException(Effect$dException.error("index 1\nExpected: " + showMaybe.show($3.expected) + "\nActual:   " + showMaybe.show($3.actual)))();
    }
    const $4 = {expected: Data$dMaybe.$Maybe("Just", 3), actual: testArrayIndex([1, 2, 3])(2)};
    if ($4.actual.tag === "Just" && $4.expected._1 === $4.actual._1) {

    } else {
      Effect$dException.throwException(Effect$dException.error("index 2\nExpected: " + showMaybe.show($4.expected) + "\nActual:   " + showMaybe.show($4.actual)))();
    }
    const $5 = {expected: Data$dMaybe.Nothing, actual: testArrayIndex([1, 2, 3])(3)};
    if ($5.actual.tag === "Nothing") { return; }
    return Effect$dException.throwException(Effect$dException.error("index 3\nExpected: " + showMaybe.show($5.expected) + "\nActual:   " + showMaybe.show($5.actual)))();
  };
})();
export {main, showMaybe, testArrayIndex};
