/** "1 character" / "3 characters". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
