import re

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    code = f.read()

# For monomorphizeExpr
def replace_monomorphize(m):
    return m.group(0).replace("modName instMap", "globalAstMap modName instMap")

code = re.sub(r'monomorphizeExpr\s+::\s+String\s+->', 'monomorphizeExpr :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeExpr\s+modName\s+instMap', 'monomorphizeExpr globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeBind\s+::\s+String\s+->', 'monomorphizeBind :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeBind\s+modName\s+instMap', 'monomorphizeBind globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeBinding\s+::\s+String\s+->', 'monomorphizeBinding :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeBinding\s+modName\s+instMap', 'monomorphizeBinding globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeBindLocal\s+::\s+String\s+->', 'monomorphizeBindLocal :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeBindLocal\s+modName\s+instMap', 'monomorphizeBindLocal globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeBindingLocal\s+::\s+String\s+->', 'monomorphizeBindingLocal :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeBindingLocal\s+modName\s+instMap', 'monomorphizeBindingLocal globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeAlt\s+::\s+String\s+->', 'monomorphizeAlt :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeAlt\s+modName\s+instMap', 'monomorphizeAlt globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeCaseGuard\s+::\s+String\s+->', 'monomorphizeCaseGuard :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeCaseGuard\s+modName\s+instMap', 'monomorphizeCaseGuard globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeGuard\s+::\s+String\s+->', 'monomorphizeGuard :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeGuard\s+modName\s+instMap', 'monomorphizeGuard globalAstMap modName instMap', code)
code = re.sub(r'monomorphizeProp\s+::\s+String\s+->', 'monomorphizeProp :: Map String (Binding Ann) -> String ->', code)
code = re.sub(r'monomorphizeProp\s+modName\s+instMap', 'monomorphizeProp globalAstMap modName instMap', code)

# The lookup inside monomorphizeExpr
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

