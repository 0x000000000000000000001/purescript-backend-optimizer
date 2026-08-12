const fs = require('fs');
const log = fs.readFileSync('spago_trace.log', 'utf8');
const lines = log.split('\n');
const callers = lines.filter(l => l.includes('monomorphizeExpr') || l.includes('collectInstantiations') || l.includes('eq__2276491096'));
console.log(callers.join('\n'));
