const test = x => {
  const result = [x];
  result.push(12);
  const $0 = result;
  result.push($0.length);
  return result;
};
export {test};
