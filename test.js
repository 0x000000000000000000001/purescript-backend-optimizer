const fs = require('fs');
const content = fs.readFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', 'utf8');
const lines = content.split('\n');
const start = lines.findIndex(l => l.includes('rewriteExpr globalAstMap locals substFn expr ='));
console.log(lines.slice(start, start + 30).join('\n'));
