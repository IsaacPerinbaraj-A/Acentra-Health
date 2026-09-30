import { useEffect } from 'react';

export const APP_NAME = 'RiskLens';

/** useDocumentTitle("Flag queue") -> document.title = "Flag queue · RiskLens". Empty -> "RiskLens". */
export default function useDocumentTitle(title) {
  useEffect(() => {
    const t = typeof title === 'string' || typeof title === 'number' ? String(title).trim() : '';
    document.title = t ? `${t} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

// Named export too, so both import styles work.
export { useDocumentTitle };
