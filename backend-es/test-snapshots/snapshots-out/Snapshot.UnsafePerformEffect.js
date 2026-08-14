import * as Effect$dRef from "../Effect.Ref/index.js";
const test = f => {
  const ref = Effect$dRef._new(0)();
  const $0 = Effect$dRef.modify_($0 => 1 + $0 | 0)(f(ref));
  return () => {
    $0();
    return Effect$dRef.modify_($1 => 1 + $1 | 0)(ref)();
  };
};
export {test};
