const test = random => () => {
  const x = random();
  const x1 = random();
  const n = (() => {
    const y = random();
    return x1 + y | 0;
  })();
  const m = random();
  return (x + n | 0) - m | 0;
};
export {test};
