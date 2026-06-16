module.exports = {
    test: {
        environment: "node",
        setupFiles: ["./tests/setup.js"],
        include: ["tests/**/*.test.js"],
        exclude: ["tests/utils.test.js", "tests/logic-modules.test.js", "tests/notion-oauth.test.js"],
    },
};
