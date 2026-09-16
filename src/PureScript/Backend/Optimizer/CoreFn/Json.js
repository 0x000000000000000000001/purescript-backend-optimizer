// This checks the JSON number before any conversion to a 32-bit PureScript Int.
export const isNonNegativeInteger = value => Number.isInteger(value) && value >= 0;
