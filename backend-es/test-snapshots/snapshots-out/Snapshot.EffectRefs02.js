import * as Data$dTuple from "../Data.Tuple/index.js";
import * as Effect$dRef from "../Effect.Ref/index.js";
const test3 = /* #__PURE__ */ (() => {
  const $0 = Effect$dRef._new(0);
  return () => {
    const count = $0();
    return Data$dTuple.$Tuple(
      count,
      n => {
        const $1 = Effect$dRef.modifyImpl(s => {
          const s$p = s + n | 0;
          return {state: s$p, value: s$p};
        })(count);
        return () => {$1();};
      }
    );
  };
})();
const test2 = /* #__PURE__ */ (() => {
  const $0 = Effect$dRef._new(0);
  return () => {
    const count = $0();
    return n => {
      const $1 = Effect$dRef.modifyImpl(s => {
        const s$p = s + n | 0;
        return {state: s$p, value: s$p};
      })(count);
      return () => {$1();};
    };
  };
})();
const test1 = hi => {
  const $0 = Effect$dRef._new(0);
  return () => {
    const count = $0();
    const $$continue = Effect$dRef._new(true)();
    const $1 = Effect$dRef.read(count);
    while (Effect$dRef.read($$continue)()) {
      const n = $1();
      if (n < hi) {
        Effect$dRef.write(n + 1 | 0)(count)();
      } else {
        Effect$dRef.write(false)($$continue)();
      }
    }
    return Effect$dRef.read(count)();
  };
};
export {test1, test2, test3};
