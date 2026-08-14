// @inline ConvertableOptions.convertRecordOptionsCons arity=6
// @inline ConvertableOptions.convertRecordOptionsNil always
// @inline export flub always
// @inline export flubImpl never
import * as Data$dMaybe from "../Data.Maybe/index.js";
import * as Data$dShow from "../Data.Show/index.js";
import * as Record$dUnsafe$dUnion from "../Record.Unsafe.Union/index.js";
const flubImpl = v => "???";
const defaultOptions = {foo: 42, baz: Data$dMaybe.Nothing};
const test1 = /* #__PURE__ */ flubImpl({...defaultOptions, bar: "Hello"});
const test2 = /* #__PURE__ */ flubImpl(/* #__PURE__ */ Record$dUnsafe$dUnion.unsafeUnionFn(
  /* #__PURE__ */ (() => {
    const $0 = {foo: 99, bar: "Hello"};
    return {foo: $0.foo, bar: $0.bar};
  })(),
  defaultOptions
));
const test3 = /* #__PURE__ */ flubImpl(/* #__PURE__ */ Record$dUnsafe$dUnion.unsafeUnionFn(
  /* #__PURE__ */ (() => {
    const $0 = {foo: 99, bar: "Hello", baz: Data$dMaybe.$Maybe("Just", true)};
    return {foo: $0.foo, baz: $0.baz, bar: $0.bar};
  })(),
  defaultOptions
));
const test4 = /* #__PURE__ */ flubImpl(/* #__PURE__ */ Record$dUnsafe$dUnion.unsafeUnionFn(
  /* #__PURE__ */ (() => {
    const $0 = {foo: 99, bar: 42, baz: true};
    return {foo: $0.foo, baz: Data$dMaybe.$Maybe("Just", $0.baz), bar: Data$dShow.showIntImpl($0.bar)};
  })(),
  defaultOptions
));
export {defaultOptions, flubImpl, test1, test2, test3, test4};
