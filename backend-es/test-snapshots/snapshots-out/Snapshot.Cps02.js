// @inline Snapshot.Cps02.mkState always
// @inline Snapshot.Cps02.unState always
// @inline Snapshot.Cps02.put arity=1
// @inline Snapshot.Cps02.get always
import * as Data$dTuple from "../Data.Tuple/index.js";
const State = x => x;
const unState = v => k$p => s => v(($0, $1) => k$p($0)($1), s);
const runState = s => k => k(($0, $1) => Data$dTuple.$Tuple($0, $1), s);
const mkState = k => (k$p, $0) => k($1 => $2 => k$p($1, $2))($0);
const put = s => (k$p, $0) => k$p(s, undefined);
const functorState = {map: f => k => (k$p, $0) => k(($1, $2) => k$p($1, f($2)), $0)};
const monadState = {Applicative0: () => applicativeState, Bind1: () => bindState};
const bindState = {bind: k1 => k2 => (k$p, $0) => k1(($1, $2) => k2($2)(($3, $4) => k$p($3, $4), $1), $0), Apply0: () => applyState};
const applyState = {apply: f => a => (k$p, $0) => f(($1, $2) => a(($3, $4) => applicativeState.pure($2($4))(($5, $6) => k$p($5, $6), $3), $1), $0), Functor0: () => functorState};
const applicativeState = {pure: a => (k$p, $0) => k$p($0, a), Apply0: () => applyState};
const $$get = (k$p, $0) => k$p($0, $0);
const test4 = (k$p, $0) => k$p($0 + 2 | 0, undefined);
export {State, applicativeState, applyState, bindState, functorState, $$get as get, mkState, monadState, put, runState, test4, unState};
