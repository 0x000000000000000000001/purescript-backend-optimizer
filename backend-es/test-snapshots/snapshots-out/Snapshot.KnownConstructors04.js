import * as $runtime from "../runtime.js";
const test3 = x => {
  if (x > 42) { return false; }
  return $runtime.fail() && $runtime.fail();
};
const test2 = f => x => {
  if (x > 42) { return f("Hello" + ", World")("Hello" + ", Universe"); }
  return f($runtime.fail() + ", World")($runtime.fail() + ", Universe");
};
const test1 = x => {
  if (x > 42) { return ["Hello" + ", World", "Hello" + ", Universe"]; }
  return [$runtime.fail() + ", World", $runtime.fail() + ", Universe"];
};
export {test1, test2, test3};
