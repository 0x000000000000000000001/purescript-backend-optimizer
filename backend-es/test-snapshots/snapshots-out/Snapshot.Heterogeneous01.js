// @inline Heterogeneous.Mapping.hmapRecord arity=2
// @inline Heterogeneous.Mapping.hmapWithIndexRecord arity=2
// @inline Heterogeneous.Mapping.mapRecordWithIndexCons arity=5
// @inline Heterogeneous.Mapping.mapRecordWithIndexNil.mapRecordWithIndexBuilder arity=2
import * as Data$dTuple from "../Data.Tuple/index.js";
import * as Record$dBuilder from "../Record.Builder/index.js";
import * as Type$dProxy from "../Type.Proxy/index.js";
const hmapWithIndexRecord = {
  hmapWithIndex: /* #__PURE__ */ (() => {
    const $0 = {
      mapRecordWithIndexBuilder: v => f => {
        const $0 = f.c;
        return x => Record$dBuilder.unsafeModify("c")($0)(x);
      }
    };
    const $1 = {
      mapRecordWithIndexBuilder: v => f => {
        const $1 = f.b;
        const $2 = $0.mapRecordWithIndexBuilder(Type$dProxy.Proxy)(f);
        return x => Record$dBuilder.unsafeModify("b")($1)($2(x));
      }
    };
    return x => {
      const $2 = x.a;
      const $3 = (() => {
        const $3 = $1.mapRecordWithIndexBuilder(Type$dProxy.Proxy)(x);
        return x$1 => Record$dBuilder.unsafeModify("a")($2)($3(x$1));
      })();
      return r1 => $3(Record$dBuilder.copyRecord(r1));
    };
  })()
};
const test2 = /* #__PURE__ */ (() => hmapWithIndexRecord.hmapWithIndex({a: $0 => 1 + $0 | 0, b: Data$dTuple.Tuple("bar"), c: a => !a}))();
const test1 = /* #__PURE__ */ (() => hmapWithIndexRecord.hmapWithIndex({a: $0 => 1 + $0 | 0, b: Data$dTuple.Tuple("bar"), c: a => !a})({a: 12, b: 42.0, c: true}))();
export {hmapWithIndexRecord, test1, test2};
