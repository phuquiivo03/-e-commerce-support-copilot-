'use client';

import { useEffect } from 'react';

/**
 * Swagger UI via CDN (no React peer-dependency issues with Next 16 / React 19).
 * The OpenAPI description is served by /api/openapi.
 */
declare global {
  interface Window {
    SwaggerUIBundle?: (options: { url: string; dom_id: string }) => unknown;
  }
}

export default function ApiDocsPage() {
  useEffect(() => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css';
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js';
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      window.SwaggerUIBundle?.({ url: '/api/openapi', dom_id: '#swagger-ui' });
    };
    document.body.appendChild(script);

    return () => {
      css.remove();
      script.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <div id="swagger-ui" />
    </div>
  );
}
