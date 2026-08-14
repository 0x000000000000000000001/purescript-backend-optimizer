const test = fn1 => fn2 => fn1(["foo", "bar", "baz", fn2({})][0])(["foo", "bar", "baz", fn2({})][2]);
export {test};
