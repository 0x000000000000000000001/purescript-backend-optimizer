const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');
const printFunc = `
printExpr :: BackendExpr -> String
printExpr (ExprRewrite _ e) = "ExprRewrite (...)"
printExpr (ExprSyntax _ syn) = case syn of
  Typed _ a -> "Typed (" <> printExpr a <> ")"
  Abs _ _ -> "Abs (...)"
  App f a -> "App (" <> printExpr f <> ") (" <> printExpr (NonEmptyArray.head a) <> ")"
  Let _ _ _ a -> "Let (" <> printExpr a <> ")"
  Var _ -> "Var"
  Local _ _ -> "Local"
  _ -> "Other"
`;
code = code.replace(/printExpr :: BackendExpr -> String[\s\S]*?_ -> "Other"\n/, printFunc);
fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', code);
