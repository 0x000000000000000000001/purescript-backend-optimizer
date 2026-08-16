// Restore Convert.purs
const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');
code = code.replace(/import Global.Unsafe \(unsafeStringify\)\n/g, '');
code = code.replace(/import Debug as Debug\n/g, '');
code = code.replace(/let _ = if ident == Ident "contains" then Debug.trace \("OPTIMIZED contains: " <> unsafeStringify optimizedExprWithTy\) \(\\_ -> unit\) else unit/g, '');
fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', code);
