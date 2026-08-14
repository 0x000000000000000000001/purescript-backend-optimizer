import * as Effect$dRef from "../Effect.Ref/index.js";
const test9 = g => {
  const $0 = Effect$dRef._new(g(42));
  return () => {
    const ref = $0();
    const prev = Effect$dRef.read(ref)();
    Effect$dRef.write(prev + 1 | 0)(ref)();
    Effect$dRef.modifyImpl(s => {
      const s$p = 1 + s | 0;
      return {state: s$p, value: s$p};
    })(ref)();
    return Effect$dRef.read(ref)();
  };
};
const test8 = g => r => {
  const $0 = g(g);
  return Effect$dRef.modifyImpl(s => {
    const s$p = $0(s);
    return {state: s$p, value: s$p};
  })(r);
};
const test7 = g => r => Effect$dRef.modifyImpl(s => {
  const s$p = g(s);
  return {state: s$p, value: s$p};
})(r);
const test6 = g => r => Effect$dRef.write(g(42))(r);
const test5 = r => Effect$dRef.write(42)(r);
const test4 = g => r => Effect$dRef.read(g(r));
const test3 = r => Effect$dRef.read(r);
const test2 = g => Effect$dRef._new(g(42));
const test1 = /* #__PURE__ */ Effect$dRef._new(42);
export {test1, test2, test3, test4, test5, test6, test7, test8, test9};
