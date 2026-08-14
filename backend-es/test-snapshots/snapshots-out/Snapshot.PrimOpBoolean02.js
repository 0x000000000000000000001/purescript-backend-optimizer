import * as Data$dOrd from "../Data.Ord/index.js";
import * as Data$dOrdering from "../Data.Ordering/index.js";
const test9 = [false, true];
const boolValues = op => [op(true)(true), op(true)(false), op(false)(true), op(false)(false)];
const test1 = [true, false, false, false];
const test2 = [true, true, true, false];
const test3 = [true, false, false, true];
const test4 = [false, true, true, false];
const test5 = /* #__PURE__ */ (() => [
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(true) === "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(false) === "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(true) === "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(false) === "LT"
])();
const test6 = /* #__PURE__ */ (() => [
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(true) === "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(false) === "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(true) === "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(false) === "GT"
])();
const test7 = /* #__PURE__ */ (() => [
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(true) !== "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(false) !== "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(true) !== "GT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(false) !== "GT"
])();
const test8 = /* #__PURE__ */ (() => [
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(true) !== "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(true)(false) !== "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(true) !== "LT",
  Data$dOrd.ordBooleanImpl(Data$dOrdering.LT)(Data$dOrdering.EQ)(Data$dOrdering.GT)(false)(false) !== "LT"
])();
export {boolValues, test1, test2, test3, test4, test5, test6, test7, test8, test9};
