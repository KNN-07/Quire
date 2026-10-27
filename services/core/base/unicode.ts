export function isCodePointBoundary(text: string, index: number): boolean {
  if (index < 0 || index > text.length) return false;
  if (index === 0 || index === text.length) return true;
  const left = text.charCodeAt(index - 1);
  const right = text.charCodeAt(index);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}
