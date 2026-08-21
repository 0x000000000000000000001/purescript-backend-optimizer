import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target1 = """                instType = substituteExprType subst genericType"""
replacement1 = """                instType = substituteExprType subst (stripTypeVariables genericType)"""

content = content.replace(target1, replacement1)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
