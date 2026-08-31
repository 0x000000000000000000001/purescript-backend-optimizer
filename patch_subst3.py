import sys

def replace_first(content, search, replace):
    if content.count(search) != 1:
        print(f"ERROR: Found {content.count(search)} occurrences.")
        sys.exit(1)
    return content.replace(search, replace)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

old_goCollect_app = """          _ -> 
            let rest = goCollect as' e
            in { subst: rest.subst, unusedIds: rest.unusedIds, expr: ExprApp (getExprAnn e) rest.expr a }"""

new_goCollect_app = """          _ -> 
            let
              applyArgs expr [] = expr
              applyArgs expr (arg:argsRest) = applyArgs (ExprApp (getExprAnn expr) expr arg) argsRest
            in
              { subst: Map.empty, unusedIds: [], expr: applyArgs e args }"""

content = replace_first(content, old_goCollect_app, new_goCollect_app)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
