const fs = require('fs');
let content = fs.readFileSync('src/PureScript/Backend/Optimizer/Convert.purs', 'utf8');

content = content.replace(
  `  fromBackendExpr = case backendExpr of
    ExprSyntax _ (App (ExprSyntax _ (Var qual)) args) ->
      case Map.lookup (EvalExtern qual) directives >>= Map.lookup InlineRef of
        Just (InlineArity n)
          | ExprApp (Ann { meta: Just IsSyntheticApp }) _ _ <- cfn
          , arity <- NonEmptyArray.length args
          , arity >= n ->
              Just $ Map.singleton InlineRef InlineAlways
        _ ->
          Nothing`,
  `  fromBackendExpr = case backendExpr of
    ExprSyntax _ (App (ExprSyntax _ (Var qual)) args)
      | ExprApp (Ann { meta: Just IsSyntheticApp }) _ _ <- cfn ->
          Just $ Map.singleton InlineRef InlineAlways
      | otherwise ->
          case Map.lookup (EvalExtern qual) directives >>= Map.lookup InlineRef of
            Just (InlineArity n)
              | arity <- NonEmptyArray.length args
              , arity >= n ->
                  Just $ Map.singleton InlineRef InlineAlways
            _ ->
              Nothing`
);

content = `import Debug as Debug\n` + content;

content = content.replace(
  `              let Tuple backendExpr cfn = fromJust $ Array.index converted i
              in case inferTransitiveDirective env.directives (snd impl) backendExpr cfn of
                   Just dirs -> Map.insert (EvalExtern ident) dirs accum
                   Nothing -> accum`,
  `              let Tuple backendExpr cfn = fromJust $ Array.index converted i
                  newDirs = inferTransitiveDirective env.directives (snd impl) backendExpr cfn
              in case newDirs of
                   Just dirs ->
                     let _ = if ident == Ident "keysCons1" then Debug.trace ("keysCons1: " <> show dirs) (\\_ -> unit) else unit
                     in Map.insert (EvalExtern ident) dirs accum
                   Nothing ->
                     let _ = if ident == Ident "keysCons1" then Debug.trace "keysCons1: Nothing" (\\_ -> unit) else unit
                     in accum`
);

fs.writeFileSync('src/PureScript/Backend/Optimizer/Convert.purs', content);
