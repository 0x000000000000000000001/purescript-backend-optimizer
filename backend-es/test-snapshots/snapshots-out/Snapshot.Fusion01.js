// @inline export overArray arity=1
import * as $runtime from "../runtime.js";
import * as Data$dArray from "../Data.Array/index.js";
import * as Data$dList$dTypes from "../Data.List.Types/index.js";
import * as Data$dMaybe from "../Data.Maybe/index.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Data$dString$dCodeUnits from "../Data.String.CodeUnits/index.js";
import * as Data$dTuple from "../Data.Tuple/index.js";
import * as Data$dUnfoldable from "../Data.Unfoldable/index.js";
const toArray = v => Data$dArray.reverse(Data$dUnfoldable.unfoldrArrayImpl(Data$dMaybe.isNothing)(v$1 => {
  if (v$1.tag === "Just") { return v$1._1; }
  $runtime.fail();
})(Data$dTuple.fst)(Data$dTuple.snd)(xs => {
  if (xs.tag === "Nil") { return Data$dMaybe.Nothing; }
  if (xs.tag === "Cons") { return Data$dMaybe.$Maybe("Just", Data$dTuple.$Tuple(xs._1, xs._2)); }
  $runtime.fail();
})(v(Data$dList$dTypes.Cons)(Data$dList$dTypes.Nil)));
const test = x => toArray(cons => nil => {
  const loop = loop$a0$copy => {
    let loop$a0 = loop$a0$copy, loop$c = true, loop$r;
    while (loop$c) {
      const n = loop$a0;
      loop$c = false;
      loop$r = acc => {
        if (n === 0) { return acc; }
        return loop(n - 1 | 0)((() => {
          const v1 = Data$dString$dCodeUnits.stripPrefix("1")(Data$dShow.showIntImpl(1 + x[n] | 0));
          if (v1.tag === "Just") {
            const $0 = "2" + v1._1;
            if ($0 !== "wat") { return cons($0 + "1")(acc); }
            return acc;
          }
          if (v1.tag === "Nothing") { return acc; }
          $runtime.fail();
        })());
      };
    }
    return loop$r;
  };
  return loop(x.length - 1 | 0)(nil);
});
export {test, toArray};
