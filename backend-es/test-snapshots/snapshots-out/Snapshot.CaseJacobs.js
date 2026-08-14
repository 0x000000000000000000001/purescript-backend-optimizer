import * as $runtime from "../runtime.js";
const $Expr = (tag, _1, _2) => ({tag, _1, _2});
const Add = value0 => value1 => $Expr("Add", value0, value1);
const Mul = value0 => value1 => $Expr("Mul", value0, value1);
const Succ = value0 => $Expr("Succ", value0);
const Zero = /* #__PURE__ */ $Expr("Zero");
const showExpr = {
  show: v => {
    if (v.tag === "Add") { return "Add(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
    if (v.tag === "Mul") { return "Mul(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
    if (v.tag === "Succ") { return "Succ(" + showExpr.show(v._1) + ")"; }
    if (v.tag === "Zero") { return "Zero"; }
    $runtime.fail();
  }
};
const test1 = v => {
  if (v.tag === "Add") {
    if (v._2.tag === "Zero") {
      if (v._1.tag === "Zero") { return "e1"; }
      if (v._1.tag === "Succ") {
        return (() => {
          if (v._1._1.tag === "Add") { return "e3: Add(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ")"; }
          if (v._1._1.tag === "Mul") { return "e3: Mul(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ")"; }
          if (v._1._1.tag === "Succ") { return "e3: Succ(" + showExpr.show(v._1._1._1) + ")"; }
          if (v._1._1.tag === "Zero") { return "e3: Zero"; }
          $runtime.fail();
        })() + (() => {
          if (v._2.tag === "Add") { return " Add(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
          if (v._2.tag === "Mul") { return " Mul(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
          if (v._2.tag === "Succ") { return " Succ(" + showExpr.show(v._2._1) + ")"; }
          if (v._2.tag === "Zero") { return " Zero"; }
          $runtime.fail();
        })();
      }
      if (v._1.tag === "Add") { return "e6: Add(" + showExpr.show(v._1._1) + " " + showExpr.show(v._1._2) + ")"; }
      if (v._1.tag === "Mul") { return "e6: Mul(" + showExpr.show(v._1._1) + " " + showExpr.show(v._1._2) + ")"; }
      if (v._1.tag === "Succ") { return "e6: Succ(" + showExpr.show(v._1._1) + ")"; }
      if (v._1.tag === "Zero") { return "e6: Zero"; }
      $runtime.fail();
    }
    if (v._1.tag === "Succ") {
      return (() => {
        if (v._1._1.tag === "Add") { return "e3: Add(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ")"; }
        if (v._1._1.tag === "Mul") { return "e3: Mul(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ")"; }
        if (v._1._1.tag === "Succ") { return "e3: Succ(" + showExpr.show(v._1._1._1) + ")"; }
        if (v._1._1.tag === "Zero") { return "e3: Zero"; }
        $runtime.fail();
      })() + (() => {
        if (v._2.tag === "Add") { return " Add(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
        if (v._2.tag === "Mul") { return " Mul(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
        if (v._2.tag === "Succ") { return " Succ(" + showExpr.show(v._2._1) + ")"; }
        if (v._2.tag === "Zero") { return " Zero"; }
        $runtime.fail();
      })();
    }
    if (v.tag === "Add") { return "e7: Add(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
    if (v.tag === "Mul") { return "e7: Mul(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
    if (v.tag === "Succ") { return "e7: Succ(" + showExpr.show(v._1) + ")"; }
    if (v.tag === "Zero") { return "e7: Zero"; }
    $runtime.fail();
  }
  if (v.tag === "Mul") {
    if (v._1.tag === "Zero") {
      if (v._2.tag === "Add") { return "e2: Add(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
      if (v._2.tag === "Mul") { return "e2: Mul(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
      if (v._2.tag === "Succ") { return "e2: Succ(" + showExpr.show(v._2._1) + ")"; }
      if (v._2.tag === "Zero") { return "e2: Zero"; }
      $runtime.fail();
    }
    if (v._2.tag === "Zero") {
      if (v._1.tag === "Add") { return "e4: Add(" + showExpr.show(v._1._1) + " " + showExpr.show(v._1._2) + ")"; }
      if (v._1.tag === "Mul") { return "e4: Mul(" + showExpr.show(v._1._1) + " " + showExpr.show(v._1._2) + ")"; }
      if (v._1.tag === "Succ") { return "e4: Succ(" + showExpr.show(v._1._1) + ")"; }
      if (v._1.tag === "Zero") { return "e4: Zero"; }
      $runtime.fail();
    }
    if (v._1.tag === "Add") {
      return (() => {
        if (v._1._1.tag === "Add") { return "e5: Add(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ") "; }
        if (v._1._1.tag === "Mul") { return "e5: Mul(" + showExpr.show(v._1._1._1) + " " + showExpr.show(v._1._1._2) + ") "; }
        if (v._1._1.tag === "Succ") { return "e5: Succ(" + showExpr.show(v._1._1._1) + ") "; }
        if (v._1._1.tag === "Zero") { return "e5: Zero "; }
        $runtime.fail();
      })() + (() => {
        if (v._1._2.tag === "Add") { return "Add(" + showExpr.show(v._1._2._1) + " " + showExpr.show(v._1._2._2) + ")"; }
        if (v._1._2.tag === "Mul") { return "Mul(" + showExpr.show(v._1._2._1) + " " + showExpr.show(v._1._2._2) + ")"; }
        if (v._1._2.tag === "Succ") { return "Succ(" + showExpr.show(v._1._2._1) + ")"; }
        if (v._1._2.tag === "Zero") { return "Zero"; }
        $runtime.fail();
      })() + (() => {
        if (v._2.tag === "Add") { return " Add(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
        if (v._2.tag === "Mul") { return " Mul(" + showExpr.show(v._2._1) + " " + showExpr.show(v._2._2) + ")"; }
        if (v._2.tag === "Succ") { return " Succ(" + showExpr.show(v._2._1) + ")"; }
        if (v._2.tag === "Zero") { return " Zero"; }
        $runtime.fail();
      })();
    }
  }
  if (v.tag === "Add") { return "e7: Add(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
  if (v.tag === "Mul") { return "e7: Mul(" + showExpr.show(v._1) + " " + showExpr.show(v._2) + ")"; }
  if (v.tag === "Succ") { return "e7: Succ(" + showExpr.show(v._1) + ")"; }
  if (v.tag === "Zero") { return "e7: Zero"; }
  $runtime.fail();
};
export {$Expr, Add, Mul, Succ, Zero, showExpr, test1};
