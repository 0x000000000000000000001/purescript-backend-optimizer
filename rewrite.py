import re

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    code = f.read()

# For collectExpr
def replace_collect(m):
    return m.group(0).replace("modName acc", "globalAstMap modName acc")

code = re.sub(r'collectExpr\s+::\s+String\s+->', 'collectExpr :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectExpr\s+modName\s+acc', 'collectExpr globalAstMap modName acc', code)
code = re.sub(r'collectBinding\s+::\s+String\s+->', 'collectBinding :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectBinding\s+modName\s+acc', 'collectBinding globalAstMap modName acc', code)
code = re.sub(r'collectProp\s+::\s+String\s+->', 'collectProp :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectProp\s+modName\s+acc', 'collectProp globalAstMap modName acc', code)
code = re.sub(r'collectAlt\s+::\s+String\s+->', 'collectAlt :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectAlt\s+modName\s+acc', 'collectAlt globalAstMap modName acc', code)
code = re.sub(r'collectGuard\s+::\s+String\s+->', 'collectGuard :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectGuard\s+modName\s+acc', 'collectGuard globalAstMap modName acc', code)
code = re.sub(r'collectBind\s+::\s+String\s+->', 'collectBind :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'collectBind\s+modName\s+acc', 'collectBind globalAstMap modName acc', code)

# The lookup inside collectExpr
lookup_str = """          let
             genericType = case mbMod of
               Just (ModuleName mn) ->
                 case Map.lookup (mn <> "." <> name) globalAstMap of
                   Just (Binding _ _ val) -> getExprAnnType val
                   Nothing -> fromMaybe Any varAnn.type
               Nothing -> fromMaybe Any varAnn.type"""
code = code.replace("          let\n             genericType = fromMaybe Any varAnn.type", lookup_str, 1)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(code)

