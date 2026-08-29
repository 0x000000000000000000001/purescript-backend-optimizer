const fs = require('fs');
const content = fs.readFileSync('src/PureScript/Backend/Optimizer/Cache.js', 'utf8');

const newContent = content.replace(
  'export const clearPurmetaCacheImpl = function() {\n  return function() {\n    ramCache.clear();\n  };\n};',
  'export const clearPurmetaCacheImpl = function() {\n  ramCache.clear();\n};'
);

fs.writeFileSync('src/PureScript/Backend/Optimizer/Cache.js', newContent);
