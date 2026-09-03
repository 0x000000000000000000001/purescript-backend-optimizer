const fs = require('fs');
const file = 'src/PureScript/Backend/Optimizer/Monomorphize.purs';
let content = fs.readFileSync(file, 'utf8');

const regex = /collectLocalExpr :: Set Ident -> LocalInstMap -> Expr Ann -> LocalInstMap\ncollectLocalExpr targets acc expr = case expr of[\s\S]*?\n            \)\n          in go acc' e/;

const replacement = `collectLocalExpr :: Set Ident -> Set Ident -> LocalInstMap -> Expr Ann -> LocalInstMap
collectLocalExpr targets recIds acc outerExpr =
  let
    go recs acc' expr =
      case expr of
        ExprVar ann v ->
          let id = localId (Tuple.fst v) (Tuple.snd v)
          in if Set.member id targets && not (Set.member id recs) then
            let
              genericType = case ann of Ann a -> fromMaybe Any a.type
            in
              Map.insertWith (\\old new -> { genericType: new.genericType, insts: old.insts <> new.insts }) id { genericType, insts: [Map.empty] } acc'
          else
            acc'
        ExprApp ann f arg ->
          let
            spineRec = collectSpine (ExprApp ann f arg)
            f_var = spineRec.f_var
            spine = spineRec.spine
            typeArgs = getSpineTypeArgs spine
            args = getSpineArgs spine
            
            acc1 = case f_var of
              ExprVar _ (Qualified Nothing id) | Set.member id targets && not (Set.member id recs) ->
                let
                  genericType = case getExprAnn f_var of Ann a -> fromMaybe Any a.type
                  substFromTypeArgs = buildSubst genericType typeArgs
                  
                  unifySpine :: ExprType -> Array (Expr Ann) -> Map String ExprType -> Map String ExprType
                  unifySpine _ [] s = s
                  unifySpine (ForAll _ t) args' s = unifySpine t args' s
                  unifySpine (ConstrainedType constraints t) args' s =
                    let numConstraints = Array.length constraints
                    in unifySpine t (Array.drop numConstraints args') s
                  unifySpine (Func paramTypes ret) args' s =
                    let
                      numParams = Array.length paramTypes
                      appliedArgs = Array.take numParams args'
                      remainingArgs = Array.drop numParams args'
                      s1 = foldl (\\acc3 (Tuple paramType arg3) ->
                             let actualType = case getExprAnn arg3 of Ann a -> fromMaybe Any a.type
                             in unify paramType actualType acc3
                           ) s (Array.zip paramTypes appliedArgs)
                    in
                      unifySpine ret remainingArgs s1
                  unifySpine _ _ s = s
                  
                  finalSubst = unifySpine genericType args substFromTypeArgs
                in
                  if not (Map.isEmpty finalSubst) then
                    let
                      stripForAlls = case _ of
                        ForAll _ b -> stripForAlls b
                        x -> x
                      instType = stripTypeVariables (substituteExprType finalSubst (stripForAlls genericType))
                    in
                      if (hasTypeVariables genericType) && (hasTypeVariables instType && instType == stripForAlls genericType) then
                        acc'
                      else
                        Map.insertWith (\\old new -> { genericType: new.genericType, insts: old.insts <> new.insts }) id { genericType, insts: [finalSubst] } acc'
                  else
                    Map.insertWith (\\old new -> { genericType: new.genericType, insts: old.insts <> new.insts }) id { genericType, insts: [Map.empty] } acc'
              _ -> go recs acc' f_var
            
            acc2 = foldl (go recs) acc1 args
          in
            acc2
        ExprLit _ lit -> foldl (go recs) acc' lit
        ExprConstructor _ _ _ _ -> acc'
        ExprAccessor _ e _ -> go recs acc' e
        ExprUpdate _ e props -> foldl (\\a (Prop _ p) -> go recs a p) (go recs acc' e) props
        ExprAbs _ _ e -> go recs acc' e
        ExprTypeApp _ e _ -> go recs acc' e
        ExprCase _ exprs alts -> foldl (\\a (CaseAlternative _ cg) -> case cg of
            Unconditional e' -> go recs a e'
            Guarded guards -> foldl (\\a' (Guard e1 e2) -> go recs (go recs a' e1) e2) a guards
          ) (foldl (go recs) acc' exprs) alts
        ExprLet _ binds e ->
          let
            acc'' = foldl (\\a bind ->
              case bind of
                NonRec (Binding _ _ bExpr) -> go recs a bExpr
                Rec bs ->
                  let 
                    newRecs = Set.fromFoldable (map (\\(Binding _ id _) -> localId (unwrap id) Nothing) bs)
                    combinedRecs = Set.union recs newRecs
                  in
                    foldl (\\a' (Binding _ _ bExpr) -> go combinedRecs a' bExpr) a bs
            ) acc' binds
          in go recs acc'' e
  in
    go recIds acc outerExpr`;

// Now apply it
content = content.replace(/collectLocalExpr :: Set Ident -> LocalInstMap -> Expr Ann -> LocalInstMap\ncollectLocalExpr targets acc expr = case expr of[\s\S]*?\n            \)\n          in go acc' e/, replacement);

// Wait, the original code had:
//   ExprLet _ binds e ->
//     let
//       acc' = foldl (\acc'' bind ->
//         case bind of
//           NonRec (Binding _ _ bExpr) -> collectLocalExpr targets acc'' bExpr
//           Rec bs -> foldl (\acc''' (Binding _ _ bExpr) -> collectLocalExpr targets acc''' bExpr) acc'' bs
//       ) acc binds
//     in collectLocalExpr targets acc' e

// I will match up to `ExprLet` and replace
let startIndex = content.indexOf('collectLocalExpr :: Set Ident -> LocalInstMap -> Expr Ann -> LocalInstMap');
let endIndex = content.indexOf('          Rec bs -> foldl (\\acc\'\'\' (Binding _ _ bExpr) -> collectLocalExpr targets acc\'\'\' bExpr) acc\'\' bs\n      ) acc binds\n    in collectLocalExpr targets acc\' e');

if (startIndex !== -1 && endIndex !== -1) {
  endIndex += '          Rec bs -> foldl (\\acc\'\'\' (Binding _ _ bExpr) -> collectLocalExpr targets acc\'\'\' bExpr) acc\'\' bs\n      ) acc binds\n    in collectLocalExpr targets acc\' e'.length;
  content = content.substring(0, startIndex) + replacement + content.substring(endIndex);
  fs.writeFileSync(file, content);
  console.log('Patched');
} else {
  console.log('Not found');
}
