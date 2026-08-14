import * as Type$dProxy from "../Type.Proxy/index.js";
const test6 = /* #__PURE__ */ (() => {
  const $0 = {eqRecord: v => ra => rb => ra.foo === rb.foo};
  const $1 = {
    eq: (() => {
      const $1 = {eqRecord: v => ra => rb => ra.baz === rb.baz && $0.eqRecord(Type$dProxy.Proxy)(ra)(rb)};
      return ra => rb => ra.bar === rb.bar && $1.eqRecord(Type$dProxy.Proxy)(ra)(rb);
    })()
  };
  return y => !$1.eq({foo: 42, bar: "hello", baz: false})(y);
})();
const test5 = y => 12 !== y;
const test4 = a => a !== 12;
const test3 = a => 12 !== a;
const test2 = a => b => a !== b;
const test1 = x => y => x !== y;
export {test1, test2, test3, test4, test5, test6};
