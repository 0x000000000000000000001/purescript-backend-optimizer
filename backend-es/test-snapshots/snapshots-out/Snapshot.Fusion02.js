// @inline export mapU arity=1
// @inline export filterMapU arity=1
// @inline export filterU arity=1
// @inline export fromArray arity=1
// @inline export toArray arity=1
// @inline export overArray arity=1
import * as $runtime from "../runtime.js";
import * as Data$dArray from "../Data.Array/index.js";
import * as Data$dList$dTypes from "../Data.List.Types/index.js";
import * as Data$dMaybe from "../Data.Maybe/index.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Data$dString$dCodeUnits from "../Data.String.CodeUnits/index.js";
import * as Data$dTuple from "../Data.Tuple/index.js";
import * as Data$dUnfoldable from "../Data.Unfoldable/index.js";
const $Unfold$p = (_1, _2) => ({tag: "Unfold", _1, _2});
const Unfold = value0 => value1 => $Unfold$p(value0, value1);
const test = x => {
  const $0 = (() => {
    const $0 = (() => {
      const $0 = $Unfold$p(
        0,
        ix => nothing => just => {
          if (ix === x.length) { return nothing(); }
          return just(ix + 1 | 0)(x[ix]);
        }
      );
      return $Unfold$p($0._1, s2 => nothing => just => $0._2(s2)(nothing)(s3 => a => just(s3)(1 + a | 0)));
    })();
    const $1 = $Unfold$p($0._1, s2 => nothing => just => $0._2(s2)(nothing)(s3 => a => just(s3)(Data$dShow.showIntImpl(a))));
    const $2 = $Unfold$p(
      $1._1,
      s2 => nothing => just => {
        const loop = s3 => $1._2(s3)(nothing)(s4 => a => {
          const v1 = Data$dString$dCodeUnits.stripPrefix("1")(a);
          if (v1.tag === "Nothing") { return loop(s4); }
          if (v1.tag === "Just") { return just(s4)(v1._1); }
          $runtime.fail();
        });
        return loop(s2);
      }
    );
    const $3 = $Unfold$p($2._1, s2 => nothing => just => $2._2(s2)(nothing)(s3 => a => just(s3)("2" + a)));
    const $4 = $Unfold$p(
      $3._1,
      s2 => nothing => just => {
        const loop = s3 => $3._2(s3)(nothing)(s4 => a => {
          if (a !== "wat") { return just(s4)(a); }
          return loop(s4);
        });
        return loop(s2);
      }
    );
    return $Unfold$p($4._1, s2 => nothing => just => $4._2(s2)(nothing)(s3 => a => just(s3)(a + "1")));
  })();
  const loop = s2 => acc => $0._2(s2)(v1 => Data$dArray.reverse(Data$dUnfoldable.unfoldrArrayImpl(Data$dMaybe.isNothing)(v => {
    if (v.tag === "Just") { return v._1; }
    $runtime.fail();
  })(Data$dTuple.fst)(Data$dTuple.snd)(xs => {
    if (xs.tag === "Nil") { return Data$dMaybe.Nothing; }
    if (xs.tag === "Cons") { return Data$dMaybe.$Maybe("Just", Data$dTuple.$Tuple(xs._1, xs._2)); }
    $runtime.fail();
  })(acc)))(s3 => a => loop(s3)(Data$dList$dTypes.$List("Cons", a, acc)));
  return loop($0._1)(Data$dList$dTypes.Nil);
};
export {$Unfold$p, Unfold, test};
