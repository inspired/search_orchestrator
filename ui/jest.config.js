module.exports = {
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src'],
    testMatch: ['**/__tests__/**/*.test.ts?(x)'],
    setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
    // Splunk's charts need a canvas; tests use a stand-in (jest/vizStub.js).
    moduleNameMapper: { '^@splunk/visualizations/(.*)$': '<rootDir>/jest/vizStub.js' },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'md'],
    transform: {
        '\\.md$': '<rootDir>/jest/rawTransform.js',
        '\\.[jt]sx?$': 'babel-jest',
    },
    // @splunk packages and the ESM-only markdown stack (used by Markdown) must be transformed.
    transformIgnorePatterns: [
        '/node_modules/(?!(@splunk/|react-markdown/|remark-|rehype-|unified/|bail/|trough/|vfile|unist-|mdast-|hast-|micromark|decode-named-character-reference/|character-entities|character-reference-invalid/|ccount/|escape-string-regexp/|is-plain-obj/|longest-streak/|markdown-table/|parse-entities/|property-information/|space-separated-tokens/|comma-separated-tokens/|trim-lines/|zwitch/|devlop/|inline-style-parser/|style-to-))',
    ],
};
