/** The anchor GitHub gives a heading, so the guide's own `#section` links work here too. */
export function slugify(heading: string): string {
    return heading
        .toLowerCase()
        .trim()
        .replace(/ /g, '-')
        .replace(/[^a-z0-9-]/g, '');
}
