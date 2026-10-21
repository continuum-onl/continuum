export function nextNumberedNoteTitle(titles: string[], prefix: string, knownPrefixes: string[]) {
  const recognizedPrefixes = new Set(
    [prefix, ...knownPrefixes].map((value) => value.trim().toLowerCase())
  );
  const highestNumber = titles.reduce((highest, title) => {
    const match = /^(.*?) #(\d+)$/i.exec(title.trim());
    if (!match || !recognizedPrefixes.has(match[1].toLowerCase())) return highest;
    const number = Number(match[2]);
    return Number.isSafeInteger(number) ? Math.max(highest, number) : highest;
  }, 0);
  return `${prefix} #${highestNumber + 1}`;
}
