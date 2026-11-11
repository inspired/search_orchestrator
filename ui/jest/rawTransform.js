/* Jest transform for .md files: the module is the file's text, as webpack's asset/source gives. */
module.exports = {
    process(source) {
        return { code: `module.exports = ${JSON.stringify(source)};` };
    },
};
