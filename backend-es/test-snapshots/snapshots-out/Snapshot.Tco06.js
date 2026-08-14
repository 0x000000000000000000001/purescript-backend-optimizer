const $gf = ($gf$b$copy, $gf$a0$copy) => {
  let $gf$b = $gf$b$copy, $gf$a0 = $gf$a0$copy, $gf$c = true, $gf$r;
  while ($gf$c) {
    if ($gf$b === 0) {
      const a = $gf$a0;
      $gf$b = 1;
      $gf$a0 = a;
      $gf$a1 = a + 1 | 0;
      continue;
    }
    if ($gf$b === 1) {
      const a = $gf$a0;
      $gf$c = false;
      $gf$r = b => {
        const $0 = a + b | 0;
        return f($0)($0 + 1 | 0);
      };
    }
  }
  return $gf$r;
};
const g = a => $gf(0, a);
const f = a => $gf(1, a);
export {f, g};
