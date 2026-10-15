/**
 * The default Pi promptSnippet of a tool: the first sentence of its signature
 * description, without the full stop. Pi lists a custom tool under "Available
 * tools" only when it has a snippet, so every Pi tool gets one. The text comes
 * from the shared signature, so each integration describes the tool the same way.
 */
export function signatureSnippet(description: string): string {
  const text = description.trim();
  const end = /\.(\s|$)/u.exec(text);
  const sentence = end === null ? text.split("\n", 1)[0]! : text.slice(0, end.index);
  return sentence.trim();
}
