import * as $runtime from "../runtime.js";
import * as Data$dMaybe from "../Data.Maybe/index.js";
const test1 = test1$a0$copy => {
  let test1$a0 = test1$a0$copy, test1$c = true, test1$r;
  while (test1$c) {
    const b = test1$a0;
    test1$c = false;
    test1$r = arr => {
      const v = (() => {
        const $0 = arr.length - 1 | 0;
        if ($0 >= 0 && $0 < arr.length) { return Data$dMaybe.$Maybe("Just", arr[$0]); }
        return Data$dMaybe.Nothing;
      })();
      if (0 < arr.length) {
        if (v.tag === "Just") {
          if (v._1 === 2 && arr[0] === 1) { return arr; }
          const $0 = arr[0];
          if (b) { return []; }
          return test1(b)([v._1, $0, 3, v._1, 5, 6, 7, 8, 9, 10, $0, 12, 13, 14, 15, 16, 17, ...arr]);
        }
        if (v.tag === "Nothing") { return [...arr, arr[0]]; }
        $runtime.fail();
      }
      if (v.tag === "Just") { return [...arr, v._1]; }
      if (v.tag === "Nothing") { return arr; }
      $runtime.fail();
    };
  }
  return test1$r;
};
export {test1};
