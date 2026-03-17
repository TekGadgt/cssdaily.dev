import { forwardRef, useCallback } from 'react';
import { buildTailwindSrcdoc } from '../utils/code';

export const TAILWIND_PREVIEW_WIDTH = 600;
export const TAILWIND_PREVIEW_HEIGHT = 400;

interface TailwindPreviewProps {
  html: string;
  onLoad?: () => void;
}

const TailwindPreview = forwardRef<HTMLIFrameElement, TailwindPreviewProps>(({ html, onLoad }, ref) => {
  const handleLoad = useCallback(() => {
    if (onLoad) {
      // Wait longer for Tailwind CDN to process classes after iframe load
      setTimeout(onLoad, 300);
    }
  }, [onLoad]);

  return (
    <iframe
      ref={ref}
      srcDoc={buildTailwindSrcdoc(html)}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, border: 'none', background: '#f5f5f5' }}
      onLoad={handleLoad}
    />
  );
});

TailwindPreview.displayName = 'TailwindPreview';
export default TailwindPreview;
