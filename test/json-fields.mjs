// After building PBO: node test/json-fields.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [Either, Maybe, Error] = await Promise.all([
  "Data.Either", "Data.Maybe", "Data.Argonaut.Decode.Error",
].map(load));
const compiled = resolve(output, "PureScript.Backend.Optimizer.CoreFn.Json/index.js");
const source = await readFile(compiled, "utf8");
assert.match(source, /var getField\s*=/);
assert.match(source, /var getFieldOptional\$prime\s*=/);
// Expose the compiled private helpers only to this test. Keep dependency imports
// shared, so constructors and error trees are the actual production values.
const exposed = source.replace(/from "(\.[^"]+)"/g,
  (_, relative) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(compiled), relative)).href)}`)
  + '\nexport { getField, getFieldOptional$prime as getFieldOptional };\n';
const Json = await import(`data:text/javascript;base64,${Buffer.from(exposed).toString("base64")}`);
const right = value => new Either.Right(value);
const left = value => new Either.Left(value);
const atKey = (key, error) => new Error.AtKey(key, error);

function counted(result) {
  const values = [];
  return { values, decode: json => { values.push(json); return result; } };
}

test("required fields decode exactly once, preserving successful values including null", () => {
  const value = { nested: [1, 2] };
  for (const json of [0, false, "text", null, { value: 3 }]) {
    const callback = counted(right(value));
    assert.deepEqual(Json.getField(callback.decode)({ field: json })("field"), right(value));
    assert.deepEqual(callback.values, [json]);
  }
});

test("missing required fields report AtKey MissingValue without invoking the decoder", () => {
  const callback = counted(right("unused"));
  assert.deepEqual(Json.getField(callback.decode)({})("field"), left(atKey("field", Error.MissingValue.value)));
  assert.deepEqual(callback.values, []);
});

test("required decoder errors retain their complete nested path and are decoded once", () => {
  const error = new Error.AtIndex(2, atKey("nested", new Error.TypeMismatch("Int")));
  const callback = counted(left(error));
  assert.deepEqual(Json.getField(callback.decode)({ field: null })("field"), left(atKey("field", error)));
  assert.deepEqual(callback.values, [null]);
});

test("optional missing or null fields return Nothing without invoking the decoder", () => {
  for (const object of [{}, { field: null }]) {
    const callback = counted(left(new Error.TypeMismatch("unused")));
    assert.deepEqual(Json.getFieldOptional(callback.decode)(object)("field"), right(Maybe.Nothing.value));
    assert.deepEqual(callback.values, []);
  }
});

test("present optional fields decode exactly once and wrap success in Just", () => {
  const value = { nested: [1, 2] };
  for (const json of [0, false, "", { value: 3 }]) {
    const callback = counted(right(value));
    assert.deepEqual(Json.getFieldOptional(callback.decode)({ field: json })("field"), right(new Maybe.Just(value)));
    assert.deepEqual(callback.values, [json]);
  }
});

test("optional decoder errors keep their complete path without adding a Just", () => {
  const error = new Error.AtIndex(1, atKey("nested", Error.MissingValue.value));
  const callback = counted(left(error));
  assert.deepEqual(Json.getFieldOptional(callback.decode)({ field: false })("field"), left(atKey("field", error)));
  assert.deepEqual(callback.values, [false]);
});

test("nested field helpers retain outer-to-inner error order", () => {
  const calls = [];
  const decode = json => { calls.push(json); return left(new Error.TypeMismatch("Int")); };
  const nested = json => Json.getFieldOptional(decode)(json)("inner");
  assert.deepEqual(Json.getField(nested)({ outer: { inner: "wrong" } })("outer"),
    left(atKey("outer", atKey("inner", new Error.TypeMismatch("Int")))));
  assert.deepEqual(calls, ["wrong"]);
});
