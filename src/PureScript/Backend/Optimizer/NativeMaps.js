// FFI JavaScript de `NativeMaps` : les entrées à comparateur natif n'existent
// que pour le backend Go. En JS, elles retombent sur `Data.Map.Internal` avec
// l'instance `Ord` correspondante.
import * as CoreFn from '../PureScript.Backend.Optimizer.CoreFn/index.js';
import * as DataOrd from '../Data.Ord/index.js';
import * as DataMapInternal from '../Data.Map.Internal/index.js';

let qualifiedIdentOrdCache = null;

function qualifiedIdentOrd() {
    if (qualifiedIdentOrdCache === null) {
        qualifiedIdentOrdCache = CoreFn.ordQualified(DataOrd.ordString);
    }
    return qualifiedIdentOrdCache;
}

export const qualifiedIdentCompare = null;
export const stringCompare = null;

export const lookupQualifiedIdentImpl = (_compare) => (key) => (map) =>
    DataMapInternal.lookup(qualifiedIdentOrd())(key)(map);

export const insertQualifiedIdentImpl = (_compare) => (key) => (value) => (map) =>
    DataMapInternal.insert(qualifiedIdentOrd())(key)(value)(map);

export const lookupStringImpl = (_compare) => (key) => (map) =>
    DataMapInternal.lookup(DataOrd.ordString)(key)(map);

export const insertStringImpl = (_compare) => (key) => (value) => (map) =>
    DataMapInternal.insert(DataOrd.ordString)(key)(value)(map);
