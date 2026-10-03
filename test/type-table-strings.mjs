// node test/type-table-strings.mjs [compiled-output]
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const [Decoder, C, Either, Tuple, Maybe, Error] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn.TypeTable", "PureScript.Backend.Optimizer.CoreFn",
  "Data.Either", "Data.Tuple", "Data.Maybe", "Data.Argonaut.Decode.Error",
].map(name => import(pathToFileURL(join(output, name, "index.js")))));
const decode = table => Decoder.decodeTypeTableST(table)();

test("type-level strings and row labels use the frontend PSString encoding", () => {
  for (const [input, expected] of [
    ["hello", "hello"], ["", ""], [[], ""],
    [[0, 34, 92, 10, 65, 233, 65535], "\0\"\\\nAé\uffff"],
    ["𝌆", "𝌆"], [[0xd834], "\ud834"], [[0xdf06], "\udf06"],
    [[0xd834, 0xdf06], "𝌆"], [[0xdf06, 0xd834], "\udf06\ud834"],
    [[0xd834, 65, 0xdf06], "\ud834A\udf06"],
    [[0xd834, 0xd834, 0xdf06], "\ud834𝌆"], [[0xd834, 0xdf06, 0xd834], "𝌆\ud834"],
    [[0xfffd], "\ufffd"],
  ]) {
    assert.deepEqual(decode([
      "Int", { type: "TypeLevelString", value: input },
      { type: "Row", fields: [{ label: input, type: 0 }] },
    ]), new Either.Right([
      C.Int.value, new C.TypeLevelString(expected),
      new C.Row([new Tuple.Tuple(expected, C.Int.value)], Maybe.Nothing.value),
    ]));
  }
});

test("PSString rejects malformed code units and retains field error paths", () => {
  const fail = new Error.TypeMismatch("Failed decode");
  const at = (name, error) => new Error.AtKey(name, error);
  for (const value of [null, true, 42, {}, [-1], [65536], [1114111], [1114112],
    [0.5], [4294967296], [null], [true], ["x"], [[65]], [0xd834, null], [0xd834, 65536], [65, 0xdf06, 0.5]]) {
    assert.deepEqual(decode([{ type: "TypeLevelString", value }]), new Either.Left(at("value", fail)));
    assert.deepEqual(decode([{ type: "Row", fields: [{ label: value, type: 0 }] }]), new Either.Left(at("fields", at("label", fail))));
  }
  assert.deepEqual(decode([{ type: "TypeLevelString" }]), new Either.Left(at("value", Error.MissingValue.value)));
  assert.deepEqual(decode([{ type: "Row", fields: [{ type: 0 }] }]), new Either.Left(at("fields", at("label", Error.MissingValue.value))));
  assert.deepEqual(decode([{ type: "Row", fields: [{ label: [0xd834] }] }]), new Either.Left(at("fields", at("type", Error.MissingValue.value))));
});
