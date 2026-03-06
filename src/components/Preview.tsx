import { forwardRef, useCallback } from 'react';
import { buildSrcdoc } from '../utils/code';

export const PREVIEW_WIDTH = 600;
export const PREVIEW_HEIGHT = 400;

interface PreviewProps {
  html: string;
  css: string;
  onLoad?: () => void;
}

const Preview = forwardRef<HTMLIFrameElement, PreviewProps>(({ html, css, onLoad }, ref) => {
  const handleLoad = useCallback(() => {
    if (onLoad) {
      setTimeout(onLoad, 50);
    }
  }, [onLoad]);

  return (
    <iframe
      ref={ref}
      srcDoc={buildSrcdoc(html, css)}
      sandbox="allow-same-origin"
      style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, border: 'none', background: '#f5f5f5' }}
      onLoad={handleLoad}
    />
  );
});

Preview.displayName = 'Preview';
export default Preview;
