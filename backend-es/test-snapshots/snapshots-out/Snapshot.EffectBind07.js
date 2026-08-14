const test = random => value => () => {
  const x = random();
  const c = value();
  const b = c + c | 0;
  const a = b + b | 0;
  const n = (() => {
    const x1 = random();
    const y = random();
    return ((x1 + y | 0) + a | 0) + a | 0;
  })();
  const m = random();
  return (x + n | 0) - m | 0;
};
export {test};
