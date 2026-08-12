export const stringify = function (x) {
  const cache = new Set();
  return JSON.stringify(x, function (key, value) {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) {
        return "[Circular]";
      }
      cache.add(value);
    }
    return value;
  }, 2);
};
