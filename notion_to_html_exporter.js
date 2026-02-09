const fs = require('fs');
const path = require('path');

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Generates an HTML string for a Linux.do forum post from a template.
 *
 * @param {object} options - The options for generating the HTML.
 * @param {string} options.title - The title of the post.
 * @param {string} options.date - The date of the post.
 * @param {string} options.content - The HTML content of the post.
 * @returns {string} The generated HTML string.
 */
function generatePostHtml(options = {}) {
    const safeOptions = options || {};
    const templatePath = path.join(__dirname, 'linux_do_post_template.html');
    let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

    htmlTemplate = htmlTemplate.replace(/{{TITLE}}/g, () => escapeHtml(safeOptions.title || '无标题'));
    htmlTemplate = htmlTemplate.replace(/{{DATE}}/g, () => escapeHtml(safeOptions.date || '未知日期'));
    htmlTemplate = htmlTemplate.replace(/{{CONTENT}}/g, () => safeOptions.content || '暂无内容');

    return htmlTemplate;
}

// Example Usage (mocking Notion data for demonstration)
async function exportMockNotionPage() {
    const mockNotionPageData = {
        title: "我的 Notion 笔记如何导出到 Linux.do 论坛？",
        date: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
        content: `
            <p>这是一篇从 Notion 导出的模拟文章内容。</p>
            <p>它包含了一些<b>粗体</b>文字、<i>斜体</i>文字，以及一个代码块：</p>
            <pre><code>function helloWorld() {
    console.log("Hello, Linux.do!");
}</code></pre>
            <blockquote>
                <p>引用块内容。</p>
            </blockquote>
            <ul>
                <li>列表项 1</li>
                <li>列表项 2</li>
            </ul>
        `
    };

    const generatedHtml = generatePostHtml(mockNotionPageData);

    const outputPath = path.join(__dirname, 'output_post.html');
    fs.writeFileSync(outputPath, generatedHtml);
    console.log(`Generated HTML saved to ${outputPath}`);
}

module.exports = {
    generatePostHtml,
    exportMockNotionPage,
};

// Run the example only when executed directly
if (require.main === module) {
    exportMockNotionPage();
}
