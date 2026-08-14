import * as Type$dProxy from "../Type.Proxy/index.js";
const test9 = x => "hello" === x();
const test8 = x => false;
const test7 = false;
const test6 = true;
const test5 = a => {
  const $0 = {foo: 42, bar: "hello", baz: false};
  return a.bar === $0.bar && !a.baz && a.foo === $0.foo;
};
const test4 = a => {
  const $0 = {foo: 42, bar: "hello", baz: false};
  return $0.bar === a.bar && !a.baz && $0.foo === a.foo;
};
const test3 = /* #__PURE__ */ (() => {
  const $0 = {eqRecord: v => ra => rb => ra.foo === rb.foo};
  const $1 = {eqRecord: v => ra => rb => ra.baz === rb.baz && $0.eqRecord(Type$dProxy.Proxy)(ra)(rb)};
  const $2 = {foo: 42, bar: "hello", baz: false};
  return rb => $2.bar === rb.bar && $1.eqRecord(Type$dProxy.Proxy)($2)(rb);
})();
const test2 = a => b => a.bar === b.bar && a.baz === b.baz && a.foo === b.foo;
const test10 = x => {
  const $0 = {eqRecord: v => ra => rb => ra.foo === rb.foo};
  const $1 = {eqRecord: v => ra => rb => ra.baz === rb.baz && $0.eqRecord(Type$dProxy.Proxy)(ra)(rb)};
  const $2 = {foo: 42, bar: x(), baz: true};
  return rb => $2.bar === rb.bar && $1.eqRecord(Type$dProxy.Proxy)($2)(rb);
};
const test1 = /* #__PURE__ */ (() => {
  const $0 = {eqRecord: v => ra => rb => ra.foo === rb.foo};
  const $1 = {eqRecord: v => ra => rb => ra.baz === rb.baz && $0.eqRecord(Type$dProxy.Proxy)(ra)(rb)};
  return ra => rb => ra.bar === rb.bar && $1.eqRecord(Type$dProxy.Proxy)(ra)(rb);
})();
export {test1, test10, test2, test3, test4, test5, test6, test7, test8, test9};
