import * as Effect$dConsole from "../Effect.Console/index.js";
import * as Effect$dRef from "../Effect.Ref/index.js";
const test4 = cond => ref => {
  const $0 = Effect$dRef.read(cond);
  const $1 = Effect$dRef.read(ref);
  return () => {
    while ($0()) {
      const a = $1();
      if (a < 10) {
        Effect$dConsole.log("foo")();
      } else {
        Effect$dConsole.log("wat")();
      }
    }
  };
};
const test3 = cond => ref => {
  const $0 = Effect$dRef.read(cond);
  const $1 = Effect$dRef.read(ref);
  return () => {
    while ($0()) {
      const a = $1();
      const $2 = Effect$dConsole.log("foo");
      if (a < 10) { $2(); }
    }
  };
};
const test2 = cond => {
  const $0 = Effect$dRef.read(cond);
  return () => {
    while ($0()) {
      Effect$dConsole.log("foo")();
    }
    const $1 = Effect$dConsole.log("bar");
    while (Effect$dRef.read(cond)()) {
      $1();
    }
  };
};
const test1 = cond => {
  const $0 = Effect$dRef.read(cond);
  return () => {
    while ($0()) {
      Effect$dConsole.log("foo")();
      Effect$dConsole.log("bar")();
    }
  };
};
export {test1, test2, test3, test4};
