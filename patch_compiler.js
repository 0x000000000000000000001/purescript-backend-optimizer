const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');
code = code.replace(/import Global.Unsafe \(unsafeStringify\)\n/g, '');
code = code.replace(/import Debug as Debug\n/g, '');
code = "import Debug as Debug\nimport Global.Unsafe (unsafeStringify)\n" + code;
code = code.replace(/let isDict = fst \(isTypeClassDictionaryWithProps cfn\)/g, 'let isDict = fst (isTypeClassDictionaryWithProps cfn)\n  let _ = if ident == Ident "contains" then Debug.trace ("OPTIMIZED AST FOR CONTAINS: " <> unsafeStringify optimizedExprWithTy) (\\_ -> unit) else unit');
fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', code);
