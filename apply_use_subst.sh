sed -i '' '/LetRec binds expr ->/,/valType = getExprAnnType val/c\
      LetRec binds expr ->\
        let\
          letRecSubst = inferLetRecSubst binds expr\
          binds'\'' = map (\\(Binding bindAnn name val) ->\
            let\
              rawValType = getExprAnnType val\
              valType = substituteExprType letRecSubst rawValType\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
