const fs = require('fs');
const file = 'src/PureScript/Backend/Optimizer/Monomorphize.purs';
let content = fs.readFileSync(file, 'utf8');

const defaultToAnyCode = `
defaultToAny :: ExprType -> ExprType
defaultToAny = case _ of
  TypeVar _ -> Any
  Array t -> Array (defaultToAny t)
  Func args ret -> Func (map defaultToAny args) (defaultToAny ret)
  Record props -> Record (map (\\(Tuple k v) -> Tuple k (defaultToAny v)) props)
  ADT names args -> ADT names (map defaultToAny args)
  t -> t
`;

if (!content.includes('defaultToAny :: ExprType')) {
  content = content.replace('mangleType :: ExprType -> String', defaultToAnyCode + '\nmangleType :: ExprType -> String');
}

content = content.replace(
  'in Map.insertWith Set.union qualName (Set.singleton t) acc',
  'in Map.insertWith Set.union qualName (Set.singleton (defaultToAny t)) acc'
);

content = content.replace(
  'else Map.insertWith Set.union qualName (Set.singleton instType) acc2',
  'else Map.insertWith Set.union qualName (Set.singleton (defaultToAny instType)) acc2'
);

fs.writeFileSync(file, content);
