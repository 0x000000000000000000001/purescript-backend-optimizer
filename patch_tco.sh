#!/bin/bash
sed -i '' '/unwrapAppHead :: /i\
appArgsAnalysis :: TcoExpr -> TcoAnalysis\
appArgsAnalysis (TcoExpr _ expr) = case expr of\
  App fn args -> appArgsAnalysis fn <> foldMap (tcoAnalysisOf) args\
  UncurriedApp fn args -> appArgsAnalysis fn <> foldMap (tcoAnalysisOf) args\
  UncurriedEffectApp fn args -> appArgsAnalysis fn <> foldMap (tcoAnalysisOf) args\
  Typed _ inner -> appArgsAnalysis inner\
  _ -> mempty\
' src/PureScript/Backend/Optimizer/Codegen/Tco.purs

sed -i '' "s/let analysis2 = tcoCall ref arity (foldMap tcoAnalysisOf tl')/let analysis2 = tcoCall ref arity (appArgsAnalysis hd' <> foldMap tcoAnalysisOf tl')/g" src/PureScript/Backend/Optimizer/Codegen/Tco.purs
