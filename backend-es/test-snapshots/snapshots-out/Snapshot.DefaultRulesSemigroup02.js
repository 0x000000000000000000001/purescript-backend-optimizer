import * as Type$dProxy from "../Type.Proxy/index.js";
const test4 = /* #__PURE__ */ (() => {
  const $0 = {foo: "hello", bar: ["hello"]};
  const $1 = {foo: ", World!", bar: ["World!"]};
  return {bar: [...$0.bar, ...$1.bar], foo: $0.foo + $1.foo};
})();
const test3 = /* #__PURE__ */ (() => {
  const $0 = {appendRecord: v => ra => rb => ({foo: ra.foo + rb.foo})};
  const $1 = {foo: "hello", bar: ["hello"]};
  return rb => ({...$0.appendRecord(Type$dProxy.Proxy)($1)(rb), bar: [...$1.bar, ...rb.bar]});
})();
const test2 = a => b => ({bar: [...a.bar, ...b.bar], foo: a.foo + b.foo});
const test1 = /* #__PURE__ */ (() => {
  const $0 = {appendRecord: v => ra => rb => ({foo: ra.foo + rb.foo})};
  return ra => rb => ({...$0.appendRecord(Type$dProxy.Proxy)(ra)(rb), bar: [...ra.bar, ...rb.bar]});
})();
export {test1, test2, test3, test4};
