/* What the editor derives from its previews: the result fields of each current preview (for
 * the first-row tokens) and the one-line summary each node shows. */
import { useMemo } from 'react';
import type { PreviewView } from './usePreviews';
import { previewSummary } from './usePreviews';

export default function usePreviewViews(previews: Record<string, PreviewView | undefined>) {
    const previewFields = useMemo(() => {
        const out: Record<string, string[]> = {};
        Object.keys(previews).forEach((id) => {
            const p = previews[id];
            if (p && !p.stale && p.results) {
                out[id] = p.results.fields;
            }
        });
        return out;
    }, [previews]);
    const nodePreviews = useMemo(() => {
        const out: Record<string, ReturnType<typeof previewSummary>> = {};
        Object.keys(previews).forEach((id) => {
            out[id] = previewSummary(previews[id]);
        });
        return out;
    }, [previews]);
    return { previewFields, nodePreviews };
}
