applyDicts :: Array (Expr Ann) -> Expr Ann -> Expr Ann
applyDicts args body = go args body
  where
  go dicts e = case Array.uncons dicts of
    Nothing -> e
    Just { head: d, tail: ds' } ->
      if isStatic d then
        let _ = Debug.trace ("applyDicts isStatic TRUE for dict: " <> show (getExprAnn d)) (\_ -> unit) in
        case e of
          ExprAbs ann id b ->
            let body' = go ds' b
            in ExprLet (getExprAnn body') [NonRec (Binding (getExprAnn d) id d)] body'
          _ -> go ds' (ExprApp (getExprAnn e) e d)
      else
        let _ = Debug.trace ("applyDicts isStatic FALSE for dict: " <> show (getExprAnn d)) (\_ -> unit) in
        go ds' e
