/* Search in the help: the user guide cut into its ## and ### sections, each matched on its
 * title and text (every word of the query, in any order, ignoring case and markdown). A title
 * match ranks first. */
import type { GuidePart, HelpTab } from './HelpPage';
import { slugify } from './slug';

export interface HelpHit {
    slug: string;
    title: string;
    /** The ## section a ### hit is in. */
    parent?: string;
    tab: HelpTab;
    snippet: string;
}

interface Section {
    slug: string;
    title: string;
    parent?: string;
    tab: HelpTab;
    text: string;
}

const MAX_HITS = 25;
const BEFORE = 60;
const AFTER = 160;

/** Markdown as plain words: code marks, emphasis, links, tags and table bars dropped. */
export function plainText(md: string): string {
    return md
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_]+/g, '')
        .replace(/^\s*[-|>#]+\s*/gm, '')
        .replace(/\s*\|\s*/g, ' · ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sectionsOf(parts: GuidePart[]): Section[] {
    const out: Section[] = [];
    parts.forEach((part) => {
        let cur: Section = { slug: part.slug, title: part.title, tab: part.tab, text: '' };
        out.push(cur);
        let fence = false;
        part.text
            .split('\n')
            .slice(1)
            .forEach((line) => {
                if (/^```/.test(line)) {
                    fence = !fence;
                }
                if (!fence && /^### /.test(line)) {
                    const title = line.slice(4).trim();
                    cur = { slug: slugify(title), title, parent: part.title, tab: part.tab, text: '' };
                    out.push(cur);
                    return;
                }
                cur.text += `${line}\n`;
            });
    });
    return out.map((s) => ({ ...s, title: s.title.replace(/`/g, ''), parent: s.parent && s.parent.replace(/`/g, ''), text: plainText(s.text) }));
}

function snippet(text: string, word: string): string {
    const at = text.toLowerCase().indexOf(word);
    if (at < 0) {
        return text.slice(0, BEFORE + AFTER) + (text.length > BEFORE + AFTER ? '…' : '');
    }
    const start = Math.max(0, at - BEFORE);
    const end = Math.min(text.length, at + AFTER);
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

const cache = new WeakMap<GuidePart[], Section[]>();

export function searchGuide(parts: GuidePart[], query: string): HelpHit[] {
    const words = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1);
    if (!words.length) {
        return [];
    }
    let sections = cache.get(parts);
    if (!sections) {
        sections = sectionsOf(parts);
        cache.set(parts, sections);
    }
    const scored: Array<{ hit: HelpHit; score: number; order: number }> = [];
    sections.forEach((s, order) => {
        const title = s.title.toLowerCase();
        const body = s.text.toLowerCase();
        if (!words.every((w) => title.includes(w) || body.includes(w))) {
            return;
        }
        const score = words.filter((w) => title.includes(w)).length;
        const first = words.find((w) => body.includes(w)) || words[0];
        scored.push({ hit: { slug: s.slug, title: s.title, parent: s.parent, tab: s.tab, snippet: snippet(s.text, first) }, score, order });
    });
    scored.sort((a, b) => b.score - a.score || a.order - b.order);
    return scored.slice(0, MAX_HITS).map((x) => x.hit);
}
