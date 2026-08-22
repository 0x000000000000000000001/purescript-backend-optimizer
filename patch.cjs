const fs = require('fs');
const file = 'src/PureScript/Backend/Optimizer/Semantics.purs';
let content = fs.readFileSync(file, 'utf8');

const target = `    fn, args ->
      let
        app = NeutApp fn (List.toUnfoldable args)
      in
        case mbTy of
          Just ty -> SemTyped ty app
          Nothing -> app`;

const replacement = `    fn, args ->
      let
        app = NeutApp fn (List.toUnfoldable args)
        finalTy = case mbTy of
          Just (Func args' retTy) ->
            let remaining = Array.drop (List.length args) args'
            in if Array.length remaining > 0 then Just (Func remaining retTy) else Just retTy
          _ -> mbTy
      in
        case finalTy of
          Just ty -> SemTyped ty app
          Nothing -> app`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(file, content);
    console.log("Successfully patched Semantics.purs");
} else {
    console.log("Target not found!");
}
