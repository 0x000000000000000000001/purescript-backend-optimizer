const fs = require('fs');
let content = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');

content = content.replace(
  `                     let _ = if ident == Ident "keysCons1" then Debug.trace ("keysCons1: " <> show dirs) (\\_ -> unit) else unit`,
  `                     let _ = if "keysCons" \`Data.String.contains\` show ident then Debug.trace ("MATCH dirs: " <> show ident <> " -> " <> show dirs) (\\_ -> unit) else unit`
);

content = content.replace(
  `                     let _ = if ident == Ident "keysCons1" then Debug.trace "keysCons1: Nothing" (\\_ -> unit) else unit`,
  `                     let _ = if "keysCons" \`Data.String.contains\` show ident then Debug.trace ("MATCH Nothing: " <> show ident) (\\_ -> unit) else unit`
);

fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', content);
