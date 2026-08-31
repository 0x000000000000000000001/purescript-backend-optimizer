import sys

def replace_first(content, search, replace, name):
    if content.count(search) != 1:
        print(f"ERROR in {name}: Found {content.count(search)} occurrences of search string.")
        sys.exit(1)
    return content.replace(search, replace)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

# 1. applyDicts to applyStaticArgs in exports
content = replace_first(content, "  , applyDicts", "  , applyStaticArgs", "exports")

# 2. InstantiationMap
content = replace_first(content, 
    "type InstantiationMap = Map String (Map ExprType { dictArgs :: Array (Expr Ann), callers :: Set String, subst :: Map String ExprType })",
    "type InstantiationMap = Map String (Map String { instType :: ExprType, dictArgs :: Array (Expr Ann), normalArgs :: Array (Expr Ann), callers :: Set String, subst :: Map String ExprType })", "InstantiationMap")

# 3. mangleExpr
mangle_expr = """
mangleExpr :: forall a. Expr a -> String
mangleExpr = case _ of
  ExprVar _ (Qualified mbMod (Ident name)) ->
    "Var_" <> maybe "" (\\(ModuleName mn) -> mn <> "_") mbMod <> name
  ExprLit _ (LitInt i) -> "LitInt_" <> show i
  ExprLit _ (LitNumber n) -> "LitNum_" <> show n
  ExprLit _ (LitString s) -> "LitStr_" <> s
  ExprLit _ (LitChar _) -> "LitChar"
  ExprLit _ (LitBoolean b) -> "LitBool_" <> show b
  ExprLit _ _ -> "LitUnk"
  ExprApp _ f arg -> "App_" <> mangleExpr f <> "_" <> mangleExpr arg
  ExprAccessor _ e prop -> "Acc_" <> prop <> "_" <> mangleExpr e
  ExprConstructor _ _ (Ident c) _ -> "Ctor_" <> c
  _ -> "Unk"

collectInstantiations :: InstantiationMap -> Module Ann -> InstantiationMap"""
content = replace_first(content, "collectInstantiations :: InstantiationMap -> Module Ann -> InstantiationMap", mangle_expr, "mangleExpr")

# 4. collectExprVars (delete)
collectExprVars_old = """collectExprVars :: Expr Ann -> Set String
collectExprVars = go Set.empty
  where
  go acc (ExprVar _ (Qualified mbMod (Ident name))) = Set.insert (maybe "" (\\(ModuleName mn) -> mn <> ".") mbMod <> name) acc
  go acc (ExprApp _ e1 e2) = go (go acc e1) e2
  go acc (ExprAbs _ _ e) = go acc e
  go acc (ExprLet _ binds e) = go (foldl goBind acc binds) e
  go acc (ExprTypeApp _ e _) = go acc e
  go acc (ExprCase _ exprs alts) = foldl goAlt (foldl go acc exprs) alts
  go acc (ExprAccessor _ e _) = go acc e
  go acc (ExprUpdate _ e props) = foldl goProp (go acc e) props
  go acc (ExprLit _ lit) = foldl go acc lit
  go acc _ = acc

  goBind acc (NonRec (Binding _ _ e)) = go acc e
  goBind acc (Rec binds) = foldl (\\a (Binding _ _ e) -> go a e) acc binds

  goAlt acc (CaseAlternative _ (Unconditional e)) = go acc e
  goAlt acc (CaseAlternative _ (Guarded guards)) = foldl (\\a (Guard e1 e2) -> go (go a e1) e2) acc guards

  goProp acc (Prop _ e) = go acc e"""
content = replace_first(content, collectExprVars_old, "", "collectExprVars")

# 5. collectExpr ExprVar Map.insertWith
old_insert1 = """          Map.insertWith (\\new old -> Map.unionWith (\\a b -> { dictArgs: a.dictArgs, callers: Set.union a.callers b.callers, subst: a.subst }) new old) qualName (Map.singleton (defaultToAny t) { dictArgs: [], callers: Set.singleton modName, subst: Map.empty }) acc"""
new_insert1 = """          Map.insertWith (\\new old -> Map.unionWith (\\a b -> { instType: a.instType, dictArgs: a.dictArgs, normalArgs: a.normalArgs, callers: Set.union a.callers b.callers, subst: a.subst }) new old) qualName (Map.singleton (mangleType (defaultToAny t)) { instType: defaultToAny t, dictArgs: [], normalArgs: [], callers: Set.singleton modName, subst: Map.empty }) acc"""
content = replace_first(content, old_insert1, new_insert1, "old_insert1")

# 6. collectExpr ExprApp Map.insertWith
old_insert2 = """             { dictArgs } = partitionArgs genericType args
             qualName = case mbMod of
               Just mod -> unwrap mod <> "." <> name
               Nothing -> modName <> "." <> name
          in
             if not (hasTypeVariables genericType) then acc2
             else if hasTypeVariables instType then acc2
             else Map.insertWith (\\new old -> Map.unionWith (\\a b -> { dictArgs: a.dictArgs, callers: Set.union a.callers b.callers, subst: a.subst }) new old) qualName (Map.singleton (defaultToAny instType) { dictArgs, callers: Set.singleton modName, subst }) acc2"""
new_insert2 = """             { dictArgs, normalArgs } = partitionArgs genericType args
             qualName = case mbMod of
               Just mod -> unwrap mod <> "." <> name
               Nothing -> modName <> "." <> name
             staticNormalArgs = Array.filter isStatic normalArgs
             specKey = mangleType (defaultToAny instType) <> "_" <> String.joinWith "_" (map mangleExpr staticNormalArgs)
          in
             if not (hasTypeVariables genericType) then acc2
             else if hasTypeVariables instType then acc2
             else Map.insertWith (\\new old -> Map.unionWith (\\a b -> { instType: a.instType, dictArgs: a.dictArgs, normalArgs: a.normalArgs, callers: Set.union a.callers b.callers, subst: a.subst }) new old) qualName (Map.singleton specKey { instType: defaultToAny instType, dictArgs, normalArgs, callers: Set.singleton modName, subst }) acc2"""
content = replace_first(content, old_insert2, new_insert2, "old_insert2")

# 7. remove isFoldl
content = replace_first(content, "          isFoldl = String.contains (String.Pattern \"foldl\") name\n", "", "isFoldl")

# 8. applyDicts body
old_apply_dicts = """applyDicts :: Array (Expr Ann) -> Expr Ann -> Expr Ann
applyDicts args body = go args body
  where
  go dicts e = case Array.uncons dicts of
    Nothing -> e
    Just { head: d, tail: ds' } ->
      if isStatic d then
        case e of
          ExprAbs _ id b ->
            let
              body' = go ds' b
            in
              ExprLet (getExprAnn body') [ NonRec (Binding (getExprAnn d) id d) ] body'
          _ -> go ds' (ExprApp (getExprAnn e) e d)
      else
        case e of
          ExprAbs ann id b -> ExprAbs ann id (go ds' b)
          _ -> go ds' e"""
new_apply_static = """applyStaticArgs :: Array (Expr Ann) -> Array (Expr Ann) -> Expr Ann -> Expr Ann
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
content = replace_first(content, old_apply_dicts, new_apply_static, "applyDicts")

# 9. processBinding
old_process = """          processBinding = case Map.lookup qualName globalAstMap of
            Just (Binding ann (Ident name) expr) ->
              Array.mapMaybe
                ( \\(Tuple ty info) ->
                    if hasTypeVariables ty then Nothing
                    else
                      let
                        definerMod = case String.split (Pattern ".") qualName of
                          parts -> String.joinWith "." (fromMaybe [] (Array.init parts))
                      in
                        if modNameStr == definerMod then
                          let
                            stripForAlls = case _ of
                              ForAll _ b -> stripForAlls b
                              x -> x
                            substFn t = stripStaticConstraints info.dictArgs (substituteExprType info.subst (stripForAlls t))
                            astSubstFn t = substituteExprType info.subst (stripForAlls t)

                            exprWithDicts = applyDicts info.dictArgs expr
                            resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts

                            specializedVar = ExprVar ann (Qualified (Just (ModuleName definerMod)) (Ident (name <> "__" <> hashString (mangleType (defaultToAny finalTy)))))
                            globalSubst = Map.fromFoldable [ Tuple qualName specializedVar, Tuple name specializedVar ]
                            finalTy = stripTypeVariables (substFn ty)

                            specializedExpr = rewriteExpr globalAstMap Map.empty globalSubst astSubstFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)

                            etaExpandedExpr = case specializedExpr of
                              ExprAbs _ _ _ -> specializedExpr
                              _ | Array.length info.dictArgs == 0 -> specializedExpr
                              _ ->
                                let
                                  monomorphizedAnn = mapAnn (\\_ -> finalTy) ann
                                in
                                  case extractFuncType finalTy of
                                    Just { fArgs } ->
                                      let
                                        idents = Array.mapWithIndex (\\i _ -> Ident ("__eta" <> show i)) fArgs
                                        vars = map (\\id -> ExprVar monomorphizedAnn (Qualified Nothing id)) idents
                                        app = foldl (\\acc v -> ExprApp monomorphizedAnn acc v) specializedExpr vars
                                      in
                                        Array.foldr (\\id acc -> ExprAbs monomorphizedAnn id acc) app idents
                                    Nothing -> specializedExpr

                            newName = Ident (name <> "__" <> hashString (mangleType ty))
                            newBinding = Rec [ Binding (mapAnn (\\t -> stripTypeVariables (substFn t)) ann) newName etaExpandedExpr ]"""
new_process = """          processBinding = case Map.lookup qualName globalAstMap of
            Just (Binding ann (Ident name) expr) ->
              Array.mapMaybe
                ( \\(Tuple specKey info) ->
                    if hasTypeVariables info.instType then Nothing
                    else
                      let
                        definerMod = case String.split (Pattern ".") qualName of
                          parts -> String.joinWith "." (fromMaybe [] (Array.init parts))
                      in
                        if modNameStr == definerMod then
                          let
                            stripForAlls = case _ of
                              ForAll _ b -> stripForAlls b
                              x -> x
                            substFn t = stripStaticConstraints info.dictArgs (substituteExprType info.subst (stripForAlls t))
                            astSubstFn t = substituteExprType info.subst (stripForAlls t)

                            exprWithDicts = applyStaticArgs info.dictArgs info.normalArgs expr
                            resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts

                            specializedVar = ExprVar ann (Qualified (Just (ModuleName definerMod)) (Ident (name <> "__" <> hashString specKey)))
                            globalSubst = Map.fromFoldable [ Tuple qualName specializedVar, Tuple name specializedVar ]
                            finalTy = stripTypeVariables (substFn info.instType)

                            specializedExpr = rewriteExpr globalAstMap Map.empty globalSubst astSubstFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)

                            etaExpandedExpr = case specializedExpr of
                              ExprAbs _ _ _ -> specializedExpr
                              _ | Array.length info.dictArgs == 0 && Array.length info.normalArgs == 0 -> specializedExpr
                              _ ->
                                let
                                  monomorphizedAnn = mapAnn (\\_ -> finalTy) ann
                                in
                                  case extractFuncType finalTy of
                                    Just { fArgs } ->
                                      let
                                        idents = Array.mapWithIndex (\\i _ -> Ident ("__eta" <> show i)) fArgs
                                        vars = map (\\id -> ExprVar monomorphizedAnn (Qualified Nothing id)) idents
                                        app = foldl (\\acc v -> ExprApp monomorphizedAnn acc v) specializedExpr vars
                                      in
                                        Array.foldr (\\id acc -> ExprAbs monomorphizedAnn id acc) app idents
                                    Nothing -> specializedExpr

                            newName = Ident (name <> "__" <> hashString specKey)
                            newBinding = Rec [ Binding (mapAnn (\\t -> stripTypeVariables (substFn t)) ann) newName etaExpandedExpr ]"""
content = replace_first(content, old_process, new_process, "processBinding")

# 10. transitiveCollect
old_transitive = """            Array.foldl
              ( \\acc2 (Tuple ty info) ->
                  let
                    definerMod = case String.split (Pattern ".") qualName of
                      parts -> String.joinWith "." (fromMaybe [] (Array.init parts))

                    genericExprOpt = Map.lookup qualName globalAstMap
                  in
                    case genericExprOpt of
                      Just (Binding _ _ expr) ->
                        if hasTypeVariables ty then acc2
                        else
                          let
                            stripForAlls = case _ of
                              ForAll _ b -> stripForAlls b
                              x -> x
                            substFn t = stripStaticConstraints info.dictArgs (substituteExprType info.subst (stripForAlls t))
                            astSubstFn t = substituteExprType info.subst (stripForAlls t)
                            exprWithDicts = applyDicts info.dictArgs expr
                            resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts"""
new_transitive = """            Array.foldl
              ( \\acc2 (Tuple specKey info) ->
                  let
                    definerMod = case String.split (Pattern ".") qualName of
                      parts -> String.joinWith "." (fromMaybe [] (Array.init parts))

                    genericExprOpt = Map.lookup qualName globalAstMap
                  in
                    case genericExprOpt of
                      Just (Binding _ _ expr) ->
                        if hasTypeVariables info.instType then acc2
                        else
                          let
                            stripForAlls = case _ of
                              ForAll _ b -> stripForAlls b
                              x -> x
                            astSubstFn t = substituteExprType info.subst (stripForAlls t)
                            exprWithDicts = applyStaticArgs info.dictArgs info.normalArgs expr
                            resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts"""
content = replace_first(content, old_transitive, new_transitive, "transitiveCollect")

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)

print("Patch applied successfully via script.")
