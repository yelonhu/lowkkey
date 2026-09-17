/** Keep localized prose in the UI font while its numeric facts use aligned digits.
 * This only marks up the already-formatted string; it never parses or rounds data. */
export function NumericText({ children }: { children: string }) {
  return children.split(/([0-9０-９]+(?:[.,．:/-][0-9０-９]+)*[%％]?)/g).map((part, index) => index % 2 ? <span className="numeric" key={index}>{part}</span> : part);
}
