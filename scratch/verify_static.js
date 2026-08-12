const fs = require('fs');
const ast = JSON.parse(fs.readFileSync('output/Test.BenchCheck/corefn.json', 'utf8'));
// We just need to know if dictArgs in typeMap are static or not.
// Let's modify Monomorphize.purs to dump isStatic results!
