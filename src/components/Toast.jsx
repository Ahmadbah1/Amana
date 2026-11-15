import React, { useState, useRef, useCallback, useEffect } from 'react';

const COLORS = { info: 'bg-slate-900', success: 'bg-emerald-600', error: 'bg-red-600', warn: 'bg-amber-600' };

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const notify = useCallback((message, type = 'info') => {
    clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toastEl = toast ? (
    <div role="status" className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[60] px-4 py-3 rounded-lg shadow-lg text-sm text-white ${COLORS[toast.type] || COLORS.info}`}>
      {toast.message}
    </div>
  ) : null;

  return { notify, toastEl };
}
