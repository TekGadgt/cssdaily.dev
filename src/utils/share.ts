export function generateShareText(date: string, score: number, timeSpent: number, timeLimit: number): string {
  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  const pctUsed = timeSpent / timeLimit;
  let speedEmoji = '';
  if (pctUsed < 0.25) speedEmoji = ' \u26A1';       // lightning
  else if (pctUsed < 0.50) speedEmoji = ' \uD83C\uDFC3'; // runner
  else if (pctUsed < 0.75) speedEmoji = ' \uD83D\uDCA8'; // dashing away

  return `CSS Daily ${date}${speedEmoji}\nScore: ${score}% | Time: ${timeStr}\n\nhttps://cssdaily.dev`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const result = document.execCommand('copy');
    document.body.removeChild(textarea);
    return result;
  }
}
