import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function query(): MediaQueryList | null {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
}

/** True while the viewer asks for reduced motion (`prefers-reduced-motion: reduce`); follows changes. */
export default function usePrefersReducedMotion(): boolean {
    const [reduce, setReduce] = useState(() => Boolean(query()?.matches));
    useEffect(() => {
        const mq = query();
        if (!mq) {
            return undefined;
        }
        const onChange = () => setReduce(mq.matches);
        onChange();
        if (typeof mq.addEventListener === 'function') {
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        }
        mq.addListener(onChange);
        return () => mq.removeListener(onChange);
    }, []);
    return reduce;
}
