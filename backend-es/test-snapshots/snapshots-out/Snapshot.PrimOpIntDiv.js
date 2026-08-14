// @inline export divNoInline never
import * as $runtime from "../runtime.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Effect$dException from "../Effect.Exception/index.js";
const divNoInline = a => b => $runtime.intDiv(a, b);
const main = /* #__PURE__ */ (() => {
  const $0 = {expected: 0, actual: divNoInline(1)(0)};
  const $1 = $0.expected === $0.actual
    ? (() => {})
    : Effect$dException.throwException(Effect$dException.error("div1" + "\nExpected: " + Data$dShow.showIntImpl($0.expected) + "\nActual:   " + Data$dShow.showIntImpl($0.actual)));
  return () => {
    $1();
    const $2 = {expected: 1, actual: divNoInline(3)(2)};
    if ($2.expected === $2.actual) {

    } else {
      Effect$dException.throwException(Effect$dException.error("div2" + "\nExpected: " + Data$dShow.showIntImpl($2.expected) + "\nActual:   " + Data$dShow.showIntImpl($2.actual)))();
    }
    const $3 = {expected: -1, actual: divNoInline(3)(-2)};
    if ($3.expected === $3.actual) { return; }
    return Effect$dException.throwException(Effect$dException.error("div3" + "\nExpected: " + Data$dShow.showIntImpl($3.expected) + "\nActual:   " + Data$dShow.showIntImpl($3.actual)))();
  };
})();
export {divNoInline, main};
