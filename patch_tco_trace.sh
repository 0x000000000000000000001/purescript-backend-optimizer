#!/bin/bash
sed -i '' 's/let isLoop = maybe false tcoRoleIsLoop refBindings/let isLoop = Debug.trace ("isLoop=" <> show (maybe false tcoRoleIsLoop refBindings) <> " for " <> show refBindings) \\_ -> maybe false tcoRoleIsLoop refBindings/g' src/PureScript/Backend/Optimizer/Codegen/Tco.purs
