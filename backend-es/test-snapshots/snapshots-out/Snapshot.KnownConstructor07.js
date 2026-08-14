const test = f => y => {
  const z = f(y);
  const b = {bar: z, foo: z + 1 | 0};
  return {...b, bar: b.bar - 2 | 0};
};
export {test};
