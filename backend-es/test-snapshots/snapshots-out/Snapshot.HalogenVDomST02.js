import * as Data$dEq from "../Data.Eq/index.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Effect$dException from "../Effect.Exception/index.js";
import * as Snapshot$dHalogenVDomST01 from "../Snapshot.HalogenVDomST01/index.js";
import * as Type$dProxy from "../Type.Proxy/index.js";
const showArray = {show: /* #__PURE__ */ Data$dShow.showArrayImpl(record => "{ a: " + Data$dShow.showStringImpl(record.a) + ", b: " + Data$dShow.showIntImpl(record.b) + " }")};
const eqArray1 = {eq: /* #__PURE__ */ Data$dEq.eqArrayImpl(Data$dEq.eqIntImpl)};
const showArray1 = {show: /* #__PURE__ */ Data$dShow.showArrayImpl(Data$dShow.showIntImpl)};
const eqArray2 = {eq: /* #__PURE__ */ Data$dEq.eqArrayImpl(Data$dEq.eqStringImpl)};
const showArray2 = {show: /* #__PURE__ */ Data$dShow.showArrayImpl(Data$dShow.showStringImpl)};
const showArray3 = {
  show: /* #__PURE__ */ Data$dShow.showArrayImpl(record => "{ a: " + Data$dShow.showStringImpl(record.a) + ", b: " + Data$dShow.showIntImpl(record.b) + ", ix: " + Data$dShow.showIntImpl(record.ix) + " }")
};
const main = () => {
  const merged1 = [];
  const added1 = [];
  const deleted1 = [];
  const result = Snapshot$dHalogenVDomST01.diffWithIxE(
    ["1", "2", "3"],
    [1, 2],
    (ix, $0, $1) => {
      (() => {merged1.push({a: $0, b: $1});})();
      return {ix, a: $0, b: $1};
    },
    (v, $0) => {deleted1.push($0);},
    (ix, $0) => {
      (() => {added1.push($0);})();
      return {ix, a: "", b: $0};
    }
  );
  const m1 = [...merged1];
  const a1 = [...added1];
  const d1 = [...deleted1];
  const $0 = {expected: [{a: "1", b: 1}, {a: "2", b: 2}], actual: m1};
  if (
    (() => {
      const $1 = {eqRecord: v => ra => rb => ra.b === rb.b};
      return Data$dEq.eqArrayImpl(ra => rb => ra.a === rb.a && $1.eqRecord(Type$dProxy.Proxy)(ra)(rb))($0.expected)($0.actual);
    })()
  ) {

  } else {
    Effect$dException.throwException(Effect$dException.error("diffWithIxE/merged\nExpected: " + showArray.show($0.expected) + "\nActual:   " + showArray.show($0.actual)))();
  }
  const $1 = {expected: [], actual: a1};
  if (eqArray1.eq($1.expected)($1.actual)) {

  } else {
    Effect$dException.throwException(Effect$dException.error("diffWithIxE/added\nExpected: " + showArray1.show($1.expected) + "\nActual:   " + showArray1.show($1.actual)))();
  }
  const $2 = {expected: ["3"], actual: d1};
  if (eqArray2.eq($2.expected)($2.actual)) {

  } else {
    Effect$dException.throwException(Effect$dException.error("diffWithIxE/deleted\nExpected: " + showArray2.show($2.expected) + "\nActual:   " + showArray2.show($2.actual)))();
  }
  const $3 = {expected: [{ix: 0, a: "1", b: 1}, {ix: 1, a: "2", b: 2}], actual: result};
  if (
    (() => {
      const $4 = {eqRecord: v => ra => rb => ra.ix === rb.ix};
      return Data$dEq.eqArrayImpl((() => {
        const $5 = {eqRecord: v => ra => rb => ra.b === rb.b && $4.eqRecord(Type$dProxy.Proxy)(ra)(rb)};
        return ra => rb => ra.a === rb.a && $5.eqRecord(Type$dProxy.Proxy)(ra)(rb);
      })())($3.expected)($3.actual);
    })()
  ) {
    return;
  }
  return Effect$dException.throwException(Effect$dException.error("diffWithIxE/result\nExpected: " + showArray3.show($3.expected) + "\nActual:   " + showArray3.show($3.actual)))();
};
export {eqArray1, eqArray2, main, showArray, showArray1, showArray2, showArray3};
