import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

content = content.replace("Data.String.Pattern.Pattern", "Pattern")

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
