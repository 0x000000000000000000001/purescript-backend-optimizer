import sys

def replace_first(content, search, replace):
    if content.count(search) != 1:
        print(f"ERROR: Found {content.count(search)} occurrences.")
        sys.exit(1)
    return content.replace(search, replace)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

subst_vars = """
substituteVars :: Map Ident (Expr Ann) -> Expr Ann -> Expr Ann
substituteVars subst = go
  where
  go = case _ of
    ExprVar ann (Qualified Nothing ident) ->
      case Map.lookup ident subst of
        Just e -> e
        Nothing -> ExprVar ann (Qualified Nothing ident)
    ExprVar ann q -> ExprVar ann q
    ExprLit ann lit -> ExprLit ann (map go lit)
    ExprApp ann f arg -> ExprApp ann (go f) (go arg)
    ExprAbs ann ident body ->
      ExprAbs ann ident (substituteVars (Map.delete ident subst) body)
    ExprLet ann binds body ->
      let
        bound = foldl
          ( \\acc -> case _ of
              NonRec (Binding _ ident _) -> Set.insert ident acc
              Rec bs -> foldl (\\acc2 (Binding _ ident _) -> Set.insert ident acc2) acc bs
          )
          Set.empty
          binds
        subst' = Map.filterKeys (\\k -> not (Set.member k bound)) subst
      in
        ExprLet ann
          (map (\\b -> case b of
              NonRec (Binding annB ident expr) -> NonRec (Binding annB ident (substituteVars subst' expr))
              Rec bs -> Rec (map (\\(Binding annB ident expr) -> Binding annB ident (substituteVars subst' expr)) bs)
          ) binds)
          (substituteVars subst' body)
    ExprConstructor ann t c idents -> ExprConstructor ann t c idents
    ExprTypeApp ann e t -> ExprTypeApp ann (go e) t
    ExprCase ann exprs alts -> ExprCase ann (map go exprs) (map (\\(CaseAlternative binders guard) -> CaseAlternative binders (goGuard subst guard)) alts)
    ExprAccessor ann e prop -> ExprAccessor ann (go e) prop
    ExprUpdate ann e props -> ExprUpdate ann (go e) (map (\\(Prop p v) -> Prop p (go v)) props)

  goGuard subst (Unconditional e) = Unconditional (substituteVars subst e)
  goGuard subst (Guarded guards) = Guarded (map (\\(Guard e1 e2) -> Guard (substituteVars subst e1) (substituteVars subst e2)) guards)

applyStaticArgs ::"""

content = replace_first(content, "applyStaticArgs ::", subst_vars)

old_apply_static = """applyStaticArgs :: Array (Expr Ann) -> Array (Expr Ann) -> Expr Ann -> Expr Ann
applyStaticArgs dictArgs normalArgs body = goDicts dictArgs (goNormals normalArgs body)
  where
  goDicts dicts e = case Array.uncons dicts of
    Nothing -> e
    Just { head: d, tail: ds' } ->
      if isStatic d then
        case e of
          ExprAbs _ id b ->
            let
              body' = goDicts ds' b
            in
              ExprLet (getExprAnn body') [ NonRec (Binding (getExprAnn d) id d) ] body'
          _ -> goDicts ds' (ExprApp (getExprAnn e) e d)
      else
        case e of
          ExprAbs ann id b -> ExprAbs ann id (goDicts ds' b)
          _ -> goDicts ds' e

  goNormals ns e = case Array.uncons ns of
    Nothing -> e
    Just { head: n, tail: ns' } ->
      if isStatic n then
        case e of
          ExprAbs ann id b ->
            let
              unusedId = Ident (unwrap id <> "_unused")
              body' = goNormals ns' b
            in
              ExprAbs ann unusedId (ExprLet (getExprAnn body') [ NonRec (Binding (getExprAnn n) id n) ] body')
          _ -> goNormals ns' e
      else
        case e of
          ExprAbs ann id b -> ExprAbs ann id (goNormals ns' b)
          _ -> goNormals ns' e"""

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

content = replace_first(content, old_apply_static, new_apply_static)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
