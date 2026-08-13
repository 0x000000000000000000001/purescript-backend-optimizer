const fs = require('fs');
let content = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');

content = content.replace("import Debug as Debug\n", "");
content = content.replace("module PureScript.Backend.Optimizer.Convert where", "module PureScript.Backend.Optimizer.Convert where\nimport Debug as Debug");

fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', content);
