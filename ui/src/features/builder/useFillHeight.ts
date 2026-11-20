/* The height that lets an element reach the bottom of the window: the window height minus the
 * element's top offset and a small gap, never below `min`. Measured after every render (the
 * content above it can change) and when the window resizes. With `fixed`, the element is in a
 * fixed overlay, so its offset is from the top of the window rather than of the page. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const GAP = 16;

export default function useFillHeight(find: () => Element | null, min: number, fixed = false): number {
    const [height, setHeight] = useState(min);
    const measure = () => {
        const el = find();
        const top = el ? el.getBoundingClientRect().top + (fixed ? 0 : window.scrollY || 0) : 0;
        const next = Math.max(min, Math.floor(window.innerHeight - top - GAP));
        setHeight((h) => (h === next ? h : next));
    };
    const latest = useRef(measure);
    latest.current = measure;
    useLayoutEffect(measure);
    useEffect(() => {
        const onResize = () => latest.current();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return height;
}
