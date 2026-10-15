/** Split command arguments without treating Windows backslashes as escapes. */
export function petArguments(input: string): string[] {
  const parts: string[] = [];
  let word = "", quote = "";
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if ((char === '"' || char === "'") && word.length === 0) quote = char;
    else if (/\s/.test(char)) { if (word) { parts.push(word); word = ""; } }
    else word += char;
  }
  if (quote) throw new Error("unclosed quote in /pet arguments");
  if (word) parts.push(word);
  return parts;
}
