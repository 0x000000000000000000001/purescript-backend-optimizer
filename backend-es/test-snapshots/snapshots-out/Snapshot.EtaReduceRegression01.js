import * as $runtime from "../runtime.js";
const fold = dictFoldable => dictMonoid => dictFoldable.foldMap(dictMonoid)(x => x);
const test = v1 => {
  if (v1.tag === "Nothing") { return ""; }
  if (v1.tag === "Just") { return v1._1; }
  $runtime.fail();
};
export {fold, test};
