import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedMemo as createCurriedMemo, createStringMemo } from "../src/PureScript/Backend/Optimizer/BoundedMemo.js";
const createBoundedMemo = capacity => callback => () => {
  const memo = createCurriedMemo(capacity)(callback)();
  return (a,b) => memo(a)(b);
};

test("identity, argument order and immutable result", () => {
  const a = Object.freeze({x: 1}), b = Object.freeze({x: 1}), c = Object.freeze({x: 1});
  let calls = 0;
  const memo = createBoundedMemo(512)((x,y) => { calls++; return Object.freeze([x,y]); })();
  assert.strictEqual(memo(a,b), memo(a,b));
  assert.notStrictEqual(memo(a,b), memo(b,a));
  assert.notStrictEqual(memo(a,b), memo(a,c));
  assert.equal(calls, 3);
});

test("FIFO eviction and independent effect executions", () => {
  let calls = 0;
  const create = createBoundedMemo(2)((a,b) => { calls++; return [a,b]; });
  const memo = create();
  memo(1,0); memo(2,0); memo(1,0); memo(3,0); memo(2,0);
  assert.equal(calls, 3);
  memo(1,0);
  assert.equal(calls, 4);
  create()(1,0);
  assert.equal(calls, 5);
});

test("512 entry bound", () => {
  let calls = 0;
  const memo = createBoundedMemo(512)((a,b) => { calls++; return a+b; })();
  for (let a=0; a<512; a++) assert.equal(memo(a,0), a);
  for (let a=0; a<512; a++) assert.equal(memo(a,0), a);
  assert.equal(calls, 512);
  memo(512,0); memo(1,0); memo(0,0);
  assert.equal(calls, 514);
});

test("disabled caches and undefined results", () => {
  for (const capacity of [0,-1]) {
    let calls = 0;
    const memo = createBoundedMemo(capacity)(() => { calls++; })();
    memo(1,1); memo(1,1);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const memo = createBoundedMemo(1)(() => { calls++; })();
  memo(1,1); memo(1,1);
  assert.equal(calls, 1);
});

test("reentrant computation", () => {
  const memo = createBoundedMemo(512)((a,b) => a === 0 ? b : 1+memo(a-1,b))();
  assert.equal(memo(8,4), 12);
});

test("string memo keys distinguish module/identifier pairs and retain missing results", () => {
  let calls = 0;
  const create = createStringMemo(2)((module, ident) => { calls++; return module === "Absent" ? undefined : [module,ident]; });
  const memo=create();
  assert.strictEqual(memo("A.B")("c"),memo(["A","B"].join("."))("c"));
  assert.notDeepEqual(memo("A.B")("c"),memo("A")("B.c"));
  memo("Absent")("x"); memo("Absent")("x");
  assert.equal(calls,3);
  memo("A.B")("c"); assert.equal(calls,4);
  create()("Absent")("x"); assert.equal(calls,5);
});
