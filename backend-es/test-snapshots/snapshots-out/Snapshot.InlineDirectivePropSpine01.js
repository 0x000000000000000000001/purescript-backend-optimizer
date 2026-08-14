// @inline export watUnit(..).wat arity=1
// @inline export testImpl never
const wat = dict => dict.wat;
const testImpl = x => x;
const watUnit = dictTypeEquals => (
  {
    wat: (() => {
      const $0 = dictTypeEquals.proof(a => a);
      return x => testImpl($0(x));
    })()
  }
);
const g = x => testImpl(x);
const test2 = /* #__PURE__ */ testImpl();
const f = x => testImpl(x);
const test1 = /* #__PURE__ */ testImpl();
export {f, g, test1, test2, testImpl, wat, watUnit};
