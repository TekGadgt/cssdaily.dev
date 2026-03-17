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

/**
 * Sanitize a string for safe insertion into an HTML attribute value.
 * Strips characters that could break out of class="..." context.
 */
export function sanitizeClassValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s\-_:\/\[\]\.%#(),!]/g, '');
}

export function buildTailwindSrcdoc(html: string): string {
  // Sanitize all class attribute values in the HTML for defense-in-depth
  const sanitizedHtml = html.replace(
    /class="([^"]*)"/g,
    (_, value) => `class="${sanitizeClassValue(value)}"`
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link rel="stylesheet" href="${FONT_LINK}">
</head>
<body class="bg-[#f5f5f5] min-h-screen flex items-center justify-center p-5 font-['Inter']">
${sanitizedHtml}
</body>
</html>`;
}

export function buildTailwindScreenshotHtml(html: string): string {
  return buildTailwindSrcdoc(html);
}
