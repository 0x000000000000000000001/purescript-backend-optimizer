import * as Data$dOrd from "../Data.Ord/index.js";
import * as Data$dOrdering from "../Data.Ordering/index.js";
const stringValues = op => [op("a")("a"), op("a")("b"), op("b")("a")];
const test1 = [true, false, false];
const test2 = [false, true, true];
const test3 = /* #__PURE__ */ (() => [
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("a") === "LT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("b") === "LT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("b")("a") === "LT"
])();
const test4 = /* #__PURE__ */ (() => [
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("a") === "GT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("b") === "GT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("b")("a") === "GT"
])();
const test5 = /* #__PURE__ */ (() => [
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("a") !== "GT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("b") !== "GT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("b")("a") !== "GT"
])();
const test6 = /* #__PURE__ */ (() => [
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("a") !== "LT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("a")("b") !== "LT",
  Data$dOrd.ordStringImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)("b")("a") !== "LT"
])();
const test7 = /* #__PURE__ */ (() => ["a" + "a", "a" + "b", "b" + "a"])();
export {stringValues, test1, test2, test3, test4, test5, test6, test7};
