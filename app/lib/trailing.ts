// Strip a run of one character from the end of a string. The regex form for
// this trips sonar's super-linear check, and the loop is exact.
export const stripTrailing = (value: string, char: string): string => {
  let end = value.length;

  while (end > 0 && value[end - 1] === char) {
    end -= 1;
  }

  return value.slice(0, end);
};
