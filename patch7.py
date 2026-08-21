import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target = """                              genericType = let (Ann annRec) = getExprAnn expr in fromMaybe Any annRec.type
                              subst = unify genericType ty Map.empty"""

replacement = """                              genericType = let (Ann annRec) = getExprAnn expr in fromMaybe Any annRec.type
                              subst = unify (stripTypeVariables genericType) ty Map.empty"""

content = content.replace(target, replacement)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
