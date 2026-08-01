"use strict";
// TASK-007 辅助脚本：分析 AIAssistant 方法依赖关系，识别可安全提取的纯函数
// 运行: node scripts/analyze-ai-assistant.js

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "ai", "index.js");

function main() {
    const content = fs.readFileSync(SRC, "utf8");
    const lines = content.split("\n");

    // 找到 AIAssistant 对象范围
    const startLine = lines.findIndex(l => l.includes("const AIAssistant = {"));
    if (startLine === -1) {
        console.error("Cannot find AIAssistant object");
        return;
    }

    // 提取所有方法及其行范围
    const methods = [];
    for (let i = startLine; i < lines.length; i++) {
        const m = lines[i].match(/^    (\w+):\s*(async\s+)?\(/);
        if (m) {
            methods.push({ name: m[1], startLine: i });
        }
    }

    // 为每个方法找到结束行
    for (let idx = 0; idx < methods.length; idx++) {
        const nextStart = idx + 1 < methods.length ? methods[idx + 1].startLine : lines.length;
        let endLine = nextStart - 1;
        while (endLine > methods[idx].startLine && lines[endLine].trim() === "") endLine--;
        methods[idx].endLine = endLine;
        methods[idx].body = lines.slice(methods[idx].startLine, endLine + 1).join("\n");
    }

    // 分析每个方法是否引用 AIAssistant.xxx
    const selfRefs = new Map();
    for (const method of methods) {
        const refs = new Set();
        const regex = /AIAssistant\.(\w+)/g;
        let match;
        while ((match = regex.exec(method.body)) !== null) {
            refs.add(match[1]);
        }
        selfRefs.set(method.name, refs);
    }

    // 识别纯函数（不引用 AIAssistant 其他方法）
    const pureFunctions = [];
    const dependentFunctions = [];

    for (const method of methods) {
        const refs = selfRefs.get(method.name);
        // 排除自引用（递归）
        const externalRefs = [...refs].filter(r => r !== method.name);
        if (externalRefs.length === 0) {
            pureFunctions.push(method.name);
        } else {
            dependentFunctions.push({ name: method.name, deps: externalRefs });
        }
    }

    console.log("=== Pure Functions (can be extracted) ===");
    console.log(pureFunctions.join("\n"));
    console.log(`\nTotal: ${pureFunctions.length}`);

    console.log("\n=== Dependent Functions (need refactoring) ===");
    dependentFunctions.forEach(f => {
        console.log(`${f.name} → depends on: ${f.deps.join(", ")}`);
    });
    console.log(`\nTotal: ${dependentFunctions.length}`);

    // 按域分类纯函数
    const domains = {
        format: [],      // 格式化相关
        payload: [],     // payload 构建
        block: [],       // block 处理
        result: [],      // 结果处理
        misc: []         // 其他
    };

    for (const name of pureFunctions) {
        if (name.includes("format") || name.includes("Format")) {
            domains.format.push(name);
        } else if (name.includes("Payload") || name.includes("payload")) {
            domains.payload.push(name);
        } else if (name.includes("Block") || name.includes("block")) {
            domains.block.push(name);
        } else if (name.includes("Result") || name.includes("result")) {
            domains.result.push(name);
        } else {
            domains.misc.push(name);
        }
    }

    console.log("\n=== Domain Classification ===");
    for (const [domain, funcs] of Object.entries(domains)) {
        if (funcs.length > 0) {
            console.log(`${domain}: ${funcs.join(", ")}`);
        }
    }
}

main();
