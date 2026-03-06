export const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';

export const BASE_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  font-family: 'Inter', sans-serif;
  background: #f5f5f5;
  padding: 20px;
}
`;

export function buildSrcdoc(html: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="${FONT_LINK}">
  <style>${BASE_STYLES}\n${css}</style>
</head>
<body>${html}</body>
</html>`;
}

export function buildScreenshotHtml(html: string, css: string): string {
  return buildSrcdoc(html, css);
}
