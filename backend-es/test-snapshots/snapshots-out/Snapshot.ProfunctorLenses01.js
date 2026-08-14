// @inline Data.Lens.Lens.lens arity=2
// @inline Data.Lens.Record.prop arity=4
// @inline Data.Profunctor.Strong.strongFn.first arity=1
import * as Data$dTuple from "../Data.Tuple/index.js";
const test8 = a => {
  const $0 = (() => {
    const $0 = (() => {
      const $0 = Data$dTuple.$Tuple(a.foo, b => ({...a, foo: b}));
      return Data$dTuple.$Tuple(1 + $0._1 | 0, $0._2);
    })();
    return $0._2($0._1);
  })();
  const $1 = (() => {
    const $1 = Data$dTuple.$Tuple($0.bar, b => ({...$0, bar: b}));
    return Data$dTuple.$Tuple(42 + $1._1 | 0, $1._2);
  })();
  return $1._2($1._1);
};
const test7 = x => {
  const $0 = (() => {
    const $0 = (() => {
      const $0 = Data$dTuple.$Tuple(x.foo, b => ({...x, foo: b}));
      return Data$dTuple.$Tuple(1 + $0._1 | 0, $0._2);
    })();
    return $0._2($0._1);
  })();
  const $1 = (() => {
    const $1 = Data$dTuple.$Tuple($0.bar, b => ({...$0, bar: b}));
    return Data$dTuple.$Tuple(42 + $1._1 | 0, $1._2);
  })();
  return $1._2($1._1);
};
const test6 = a => {
  const $0 = (() => {
    const $0 = Data$dTuple.$Tuple(a.bar, b => ({...a, bar: b}));
    return Data$dTuple.$Tuple(
      (() => {
        const $1 = $0._1;
        const $2 = (() => {
          const $2 = Data$dTuple.$Tuple($1.baz, b => ({...$1, baz: b}));
          return Data$dTuple.$Tuple(1 + $2._1 | 0, $2._2);
        })();
        return $2._2($2._1);
      })(),
      $0._2
    );
  })();
  return $0._2($0._1);
};
const test5 = x => {
  const $0 = (() => {
    const $0 = Data$dTuple.$Tuple(x.bar, b => ({...x, bar: b}));
    return Data$dTuple.$Tuple(
      (() => {
        const $1 = $0._1;
        const $2 = (() => {
          const $2 = Data$dTuple.$Tuple($1.baz, b => ({...$1, baz: b}));
          return Data$dTuple.$Tuple(1 + $2._1 | 0, $2._2);
        })();
        return $2._2($2._1);
      })(),
      $0._2
    );
  })();
  return $0._2($0._1);
};
const test4 = a => {
  const $0 = (() => {
    const $0 = Data$dTuple.$Tuple(a.bar, b => ({...a, bar: b}));
    return Data$dTuple.$Tuple(1 + $0._1 | 0, $0._2);
  })();
  return $0._2($0._1);
};
const test3 = x => {
  const $0 = (() => {
    const $0 = Data$dTuple.$Tuple(x.bar, b => ({...x, bar: b}));
    return Data$dTuple.$Tuple(1 + $0._1 | 0, $0._2);
  })();
  return $0._2($0._1);
};
const test2 = a => a.foo;
const test1 = x => x.foo;
export {test1, test2, test3, test4, test5, test6, test7, test8};
