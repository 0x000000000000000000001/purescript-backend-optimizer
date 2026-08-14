import * as Data$dOrd from "../Data.Ord/index.js";
import * as Data$dOrdering from "../Data.Ordering/index.js";
const test11 = [-1.5, 1.5];
const nan = NaN;
const numValues = op => [op(1.5)(1.0), op(1.5)(2.0), op(2.5)(1.0), op(1.5)(-2.0), op(-1.5)(2.0), op(-1.5)(-1.0), op(1.0)(NaN)];
const test1 = [2.5, 3.5, 3.5, -0.5, 0.5, -2.5, NaN];
const test10 = [1.5, 0.75, 2.5, -0.75, -0.75, 1.5, NaN];
const test2 = [0.5, -0.5, 1.5, 3.5, -3.5, -0.5, NaN];
const test3 = [false, false, false, false, false, false, false];
const test4 = [true, true, true, true, true, true, true];
const test5 = /* #__PURE__ */ (() => [
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(1.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(2.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(2.5)(1.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(-2.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(2.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(-1.0) === "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.0)(NaN) === "LT"
])();
const test6 = /* #__PURE__ */ (() => [
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(1.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(2.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(2.5)(1.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(-2.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(2.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(-1.0) === "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.0)(NaN) === "GT"
])();
const test7 = /* #__PURE__ */ (() => [
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(1.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(2.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(2.5)(1.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(-2.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(2.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(-1.0) !== "GT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.0)(NaN) !== "GT"
])();
const test8 = /* #__PURE__ */ (() => [
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(1.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(2.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(2.5)(1.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.5)(-2.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(2.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(-1.5)(-1.0) !== "LT",
  Data$dOrd.ordNumberImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(1.0)(NaN) !== "LT"
])();
const test9 = [1.5, 3.0, 2.5, -3.0, -3.0, 1.5, NaN];
export {nan, numValues, test1, test10, test11, test2, test3, test4, test5, test6, test7, test8, test9};
