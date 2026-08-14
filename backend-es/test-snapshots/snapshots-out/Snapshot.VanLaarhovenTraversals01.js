// @inline export traverseFun1 arity=1
// @inline export rewriteBottomUpM arity=1
import * as $runtime from "../runtime.js";
const $Fun = (tag, _1, _2) => ({tag, _1, _2});
const Abs = value0 => value1 => $Fun("Abs", value0, value1);
const App = value0 => value1 => $Fun("App", value0, value1);
const traverseFun1 = dictApplicative => {
  const Functor0 = dictApplicative.Apply0().Functor0();
  const Apply0 = dictApplicative.Apply0();
  return k => v => {
    if (v.tag === "Abs") { return Functor0.map(Abs(v._1))(k(v._2)); }
    if (v.tag === "App") { return Apply0.apply(Functor0.map(App)(k(v._1)))(k(v._2)); }
    $runtime.fail();
  };
};
const rewriteBottomUpM = dictMonad => {
  const Applicative0 = dictMonad.Applicative0();
  const Bind1 = dictMonad.Bind1();
  return k => {
    const go = a => {
      const Functor0 = Applicative0.Apply0().Functor0();
      const Apply0 = Applicative0.Apply0();
      if (a.tag === "Abs") { return Functor0.map(Abs(a._1))(Bind1.bind(go(a._2))(k)); }
      if (a.tag === "App") { return Apply0.apply(Functor0.map(App)(Bind1.bind(go(a._1))(k)))(Bind1.bind(go(a._2))(k)); }
      $runtime.fail();
    };
    return a => Bind1.bind(go(a))(k);
  };
};
const rewriteBottomUp = k => {
  const go = a => {
    if (a.tag === "Abs") { return $Fun("Abs", a._1, k(go(a._2))); }
    if (a.tag === "App") { return $Fun("App", k(go(a._1)), k(go(a._2))); }
    $runtime.fail();
  };
  return a => k(go(a));
};
export {$Fun, Abs, App, rewriteBottomUp, rewriteBottomUpM, traverseFun1};
