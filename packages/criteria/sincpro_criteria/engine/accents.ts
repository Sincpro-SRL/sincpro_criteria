/**
 * Text read without case or accents: `Impresión` and `impresion` are the same word to a search.
 *
 * The table is the engine's own (`ddd/criteria/domain/accents.py`): every Latin letter with a
 * diacritic from U+00C0 to U+024F, in either case, read as the plain lowercase letter it is
 * written with — the character's NFD form is one ASCII letter followed only by combining marks.
 * A letter with no plain form (`ß`, `ø`, `ł`, `æ`) stays as it is. The parity file holds both
 * engines to the same answer.
 */

/** The plain lowercase letter a character is written with, or `undefined` when it has none. */
function plainLetter(letter: string): string | undefined {
  const [base, ...marks] = letter.normalize("NFD");
  if (base === undefined || !/^[A-Za-z]$/.test(base) || marks.length === 0) return undefined;
  return marks.every((mark) => /^\p{M}$/u.test(mark)) ? base.toLowerCase() : undefined;
}

const PLAIN: ReadonlyMap<string, string> = new Map(
  Array.from({ length: 0x0250 - 0x00c0 }, (_, at) =>
    String.fromCodePoint(0x00c0 + at),
  ).flatMap((letter) => {
    const plain = plainLetter(letter);
    return plain === undefined ? [] : [[letter, plain] as const];
  }),
);

/**
 * The text with its accents taken off, lowercased: what `like` and `starts with` compare, on
 * both sides — the field's text and the value typed.
 *
 * The letters are replaced before lowering, as the engine's `translate` meets them: lowering
 * first turns `İ` into two characters, an `i` and a dot.
 *
 * @example
 * fold("Impresión"); // "impresion"
 * fold("Año NUEVO"); // "ano nuevo"
 * fold("ß"); // "ß" — no plain letter, so it stays
 */
export function fold(text: string): string {
  let plain = "";
  for (const char of text) plain += PLAIN.get(char) ?? char;
  return plain.toLowerCase();
}
