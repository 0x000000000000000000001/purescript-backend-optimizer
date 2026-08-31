import sys

def replace_first(content, search, replace):
    if content.count(search) != 1:
        print(f"ERROR: Found {content.count(search)} occurrences.")
        sys.exit(1)
    return content.replace(search, replace)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

old_apply_static = """applyStaticArgs :: Array (Expr Ann) -> Array (Expr Ann) -> Expr Ann -> Expr Ann
applyStaticArgs dictArgs normalArgs body =
  let
    -- collect dictionary arguments
    resDicts = goCollect dictArgs body
    -- collect normal arguments
    resNorms = goCollect normalArgs resDicts.expr
    
    subst = Map.union resDicts.subst resNorms.subst
    
    -- substitute variables
    substBody = substituteVars subst resNorms.expr
  in
    -- re-wrap with unused arguments to keep the same arity
    wrapUnused resDicts.unusedIds (wrapUnused resNorms.unusedIds substBody)
  where
  goCollect args e = case Array.uncons args of
    Nothing -> { subst: Map.empty, unusedIds: [], expr: e }
    Just { head: a, tail: as' } ->
      if isStatic a then
        case e of
          ExprAbs _ id b ->
            let
              rest = goCollect as' b
            in
              { subst: Map.insert id a rest.subst, unusedIds: Array.cons (Ident (unwrap id <> "_unused")) rest.unusedIds, expr: rest.expr }
          _ -> 
            let rest = goCollect as' e
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: ExprApp (getExprAnn e) rest.expr a }
      else
        case e of
          ExprAbs _ id b -> 
            let rest = goCollect as' b
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: ExprAbs (getExprAnn e) id rest.expr }
          _ ->
            let rest = goCollect as' e
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: rest.expr }

  wrapUnused ids e = Array.foldr (\\id acc -> ExprAbs (getExprAnn acc) id acc) e ids"""

new_apply_static = """applyStaticArgs :: Array (Expr Ann) -> Array (Expr Ann) -> Expr Ann -> Expr Ann
applyStaticArgs dictArgs normalArgs body =
  let
    -- collect dictionary arguments
    resDicts = goCollect dictArgs body
    -- collect normal arguments
    resNorms = goCollect normalArgs resDicts.expr
    
    subst = Map.union resDicts.subst resNorms.subst
    
    -- substitute variables
    substBody = substituteVars subst resNorms.expr
  in
    -- re-wrap with unused arguments to keep the same arity
    wrapUnused resDicts.unusedIds (wrapUnused resNorms.unusedIds substBody)
  where
  goCollect args e = case Array.uncons args of
    Nothing -> { subst: Map.empty, unusedIds: [], expr: e }
    Just { head: a, tail: as' } ->
      if isStatic a then
        case e of
          ExprAbs ann id b ->
            let
              rest = goCollect as' b
            in
              { subst: Map.insert id a rest.subst, unusedIds: Array.cons (Tuple ann (Ident (unwrap id <> "_unused"))) rest.unusedIds, expr: rest.expr }
          _ -> 
            let rest = goCollect as' e
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: ExprApp (getExprAnn e) rest.expr a }
      else
        case e of
          ExprAbs _ id b -> 
            let rest = goCollect as' b
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: ExprAbs (getExprAnn e) id rest.expr }
          _ ->
            let rest = goCollect as' e
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: rest.expr }

  wrapUnused ids e = Array.foldr (\\(Tuple ann id) acc -> ExprAbs ann id acc) e ids"""

content = replace_first(content, old_apply_static, new_apply_static)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
