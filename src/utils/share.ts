export function generateShareGrid(diffCanvas: HTMLCanvasElement, cols = 5, rows = 5): string {
  const ctx = diffCanvas.getContext('2d');
  if (!ctx) return '';

  const cellW = Math.floor(diffCanvas.width / cols);
  const cellH = Math.floor(diffCanvas.height / rows);
  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const imageData = ctx.getImageData(col * cellW, row * cellH, cellW, cellH);
      const pixels = imageData.data;

      let totalDiff = 0;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a > 0) {
          // Non-transparent pixel in heatmap = difference
          totalDiff += a / 255;
          count++;
        }
      }

      const avgDiff = count > 0 ? totalDiff / (cellW * cellH) : 0;
      if (avgDiff < 0.05) line += '\u{1F7E9}'; // green
      else if (avgDiff < 0.15) line += '\u{1F7E8}'; // yellow
      else line += '\u{1F7E5}'; // red
    }
    lines.push(line);
  }

  return lines.join('\n');
}

export function generateShareText(date: string, score: number, timeSpent: number, diffCanvas: HTMLCanvasElement | null): string {
  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  let text = `CSS Daily ${date}\nScore: ${score}% | Time: ${timeStr}\n\n`;

  if (diffCanvas) {
    text += generateShareGrid(diffCanvas) + '\n\n';
  }

  text += 'https://cssdaily.dev';
  return text;
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
