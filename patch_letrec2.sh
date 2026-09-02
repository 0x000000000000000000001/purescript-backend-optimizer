cat << 'INNER' > apply_patch_letrec2.sh
sed -i '' '/inferLetRecSubst :: Array (Binding Ann) -> Expr Ann -> Map String ExprType/,/in foldl (\\a (Binding _ _ v) -> go v a) (go expr Map.empty) binds/c\
      inferLetRecSubst :: Array (Binding Ann) -> Expr Ann -> Map String ExprType\
      inferLetRecSubst binds expr = \
        let\
          names = map (\\(Binding _ (Ident n) _) -> n) binds\
          go expr acc = case expr of\
            ExprApp _ _ _ -> \
              let spine = unrollApp expr []\
                  args = getSpineArgs spine\
                  acc1 = foldl (\\a e -> go e a) acc args\
              in case Array.head spine of\
                   Just (ExprVar (Ann varAnn) (Qualified Nothing (Ident n))) -> \
                     if Array.elem n names then \
                       let expectedType = fromMaybe Any varAnn.type\
                           subst = inferSubst expectedType args\
                       in Map.union acc1 subst\
                     else acc1\
                   _ -> acc1\
            ExprLet _ e1 e2 -> go e2 (go e1 acc)\
            ExprLetRec bs e -> foldl (\\a (Binding _ _ v) -> go v a) (go e acc) bs\
            ExprCase _ bs -> foldl (\\a (CaseAlternative _ e) -> goGuard e a) acc bs\
            ExprAbs _ _ e -> go e acc\
            ExprAccessor _ _ e -> go e acc\
            ExprUpdate _ e updates -> foldl (\\a (Tuple _ v) -> go v a) (go e acc) updates\
            ExprConstructor _ _ _ e -> go e acc\
            ExprArray _ es -> foldl (\\a e -> go e a) acc es\
            ExprRecord _ updates -> foldl (\\a (Tuple _ v) -> go v a) acc updates\
            ExprVar _ _ -> acc\
            ExprLit _ _ -> acc\
          goGuard (Unconditional e) acc = go e acc\
          goGuard (Guarded guards) acc = foldl (\\a (Guard e1 e2) -> go e2 (go e1 a)) acc guards\
        in foldl (\\a (Binding _ _ v) -> go v a) (go expr Map.empty) binds\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_patch_letrec2.sh
