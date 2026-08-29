const fs = require('fs');
const content = fs.readFileSync('src/PureScript/Backend/Optimizer/Cache.js', 'utf8');

const newContent = content.replace(
  'const mem = process.memoryUsage();',
  'if (global.gc) { global.gc(); }\n    const mem = process.memoryUsage();'
);

fs.writeFileSync('src/PureScript/Backend/Optimizer/Cache.js', newContent);
