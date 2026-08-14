// @inline export variantBuildMatchCons arity=5
import * as Data$dShow from "../Data.Show/index.js";
import * as Data$dVariant from "../Data.Variant/index.js";
import * as Partial from "../Partial/index.js";
import * as Record$dUnsafe from "../Record.Unsafe/index.js";
import * as Type$dProxy from "../Type.Proxy/index.js";
const variantBuildMatchNil = {variantBuildMatch: v => k => v1 => k};
const variantBuildMatch = dict => dict.variantBuildMatch;
const variantBuildMatchCons = dictTypeEquals => () => () => dictIsSymbol => dictVariantBuildMatch => (
  {
    variantBuildMatch: v => k => r => {
      const $0 = Record$dUnsafe.unsafeGet(dictIsSymbol.reflectSymbol(Type$dProxy.Proxy))(r);
      const $1 = dictVariantBuildMatch.variantBuildMatch(Type$dProxy.Proxy)(k)(r);
      return r$1 => {
        if (r$1.type === dictIsSymbol.reflectSymbol(Type$dProxy.Proxy)) { return $0(r$1.value); }
        return $1(r$1);
      };
    }
  }
);
const match = () => dictVariantBuildMatch => dictVariantBuildMatch.variantBuildMatch(Type$dProxy.Proxy)(Data$dVariant.case_);
const test1 = /* #__PURE__ */ (() => {
  const $0 = {
    foo: a => Data$dShow.showIntImpl(a),
    bar: a => {
      if (a) { return "true"; }
      return "false";
    },
    baz: a => a
  };
  return r => {
    if (r.type === "bar") { return $0.bar(r.value); }
    if (r.type === "baz") { return $0.baz(r.value); }
    if (r.type === "foo") { return $0.foo(r.value); }
    return Partial._crashWith("Data.Variant: pattern match failure [" + r.type + "]");
  };
})();
export {match, test1, variantBuildMatch, variantBuildMatchCons, variantBuildMatchNil};
