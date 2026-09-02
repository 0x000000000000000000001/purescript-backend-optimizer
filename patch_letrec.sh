cat << 'INNER' > apply_patch_letrec.sh
sed -i '' '/LetRec binds expr ->/i\
      inferLetRecSubst :: Array (Binding Ann) -> Expr Ann -> Map String ExprType\
      inferLetRecSubst binds expr = \
        let\
          names = map (\(Binding _ (Ident n) _) -> n) binds\
          -- super simple traversal to find calls to names\
          go expr acc = case expr of\
            ExprApp _ _ _ -> \
              let spine = unrollApp expr []\
                  args = getSpineArgs spine\
              in case Array.head spine of\
                   Just (ExprVar (Ann varAnn) (Qualified Nothing (Ident n))) -> \
                     if Array.elem n names then \
                       let expectedType = fromMaybe Any varAnn.type\
                           subst = inferSubst expectedType args\
                       in Map.union acc subst\
                     else acc\
                   _ -> acc\
            ExprLet _ e1 e2 -> go e2 (go e1 acc)\
            ExprLetRec bs e -> foldl (\a (Binding _ _ v) -> go v a) (go e acc) bs\
            _ -> acc\
        in foldl (\a (Binding _ _ v) -> go v a) (go expr Map.empty) binds\
\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_patch_letrec.sh
