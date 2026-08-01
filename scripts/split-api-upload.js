"use strict";
// TASK: 提取 api/notion-upload.js（upload 簇）
// 运行: node scripts/split-api-upload.js

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "api", "index.js");
const OUT = path.join(__dirname, "..", "src", "api", "notion-upload.js");
const BACKUP_DIR = path.join(__dirname, "..", ".workflow", "scratch", "20260731-plan-P1-ai-domain-refactor", ".backups");

function main() {
    const content = fs.readFileSync(SRC, "utf8");
    const lines = content.split("\n");

    // 找到 upload 簇的起始和结束
    // 起始: "    // 创建文件上传 (single_part ≤ 20MB)"
    // 结束: "    // ========== 搜索和读取操作 (READONLY) =========="
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("// 创建文件上传 (single_part")) {
            startIdx = i;
        }
        if (lines[i].includes("// ========== 搜索和读取操作 (READONLY) ==========")) {
            endIdx = i;
            break;
        }
    }

    if (startIdx === -1 || endIdx === -1) {
        console.error("Cannot find upload cluster boundaries");
        return;
    }

    console.log(`Upload cluster: L${startIdx + 1} - L${endIdx}`);

    // 提取 upload 方法
    const uploadLines = lines.slice(startIdx, endIdx);
    
    // 构建 notion-upload.js
    const header = `"use strict";

// api/notion-upload.js — Notion 文件上传簇（TASK T4, API 域拆分）。
// 从 api/index.js 程序化提取，逻辑零修改。
// 使用 installUploadMethods(NotionAPI) 注入模式避免循环依赖。

const { CONFIG } = require("../config");
const { Utils } = require("../utils");
const { NotionOAuth } = require("../auth");

// 文件类型支持检测（内部使用）
const SUPPORTED_EXTENSIONS = {
    image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "tif", "avif", "heic", "heif"],
    video: ["mp4", "webm", "mov", "avi", "mkv", "m4v", "wmv", "flv", "mpeg", "mpg", "3gp", "ogv"],
    audio: ["mp3", "wav", "ogg", "m4a", "aac", "flac", "wma", "aiff", "opus", "weba"],
    file: ["pdf", "txt", "md", "csv", "json", "xml", "html", "css", "js", "ts", "py", "java", "c", "cpp", "h", "hpp",
           "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "tar", "gz", "bin", "exe", "dll", "so",
           "yaml", "yml", "toml", "ini", "cfg", "conf", "sh", "bat", "ps1", "rb", "go", "rs", "swift", "kt", "scala"]
};

const MIME_TYPES = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
    tiff: "image/tiff", tif: "image/tiff", avif: "image/avif", heic: "image/heic", heif: "image/heif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo",
    mkv: "video/x-matroska", m4v: "video/x-m4v", wmv: "video/x-ms-wmv", flv: "video/x-flv",
    mpeg: "video/mpeg", mpg: "video/mpeg", "3gp": "video/3gpp", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
    aac: "audio/aac", flac: "audio/flac", wma: "audio/x-ms-wma", aiff: "audio/aiff",
    opus: "audio/opus", weba: "audio/webm",
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
    json: "application/json", xml: "application/xml", html: "text/html", css: "text/css",
    js: "application/javascript", ts: "application/typescript", py: "text/x-python",
    java: "text/x-java-source", c: "text/x-c", cpp: "text/x-c++", h: "text/x-c", hpp: "text/x-c++",
    doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
    tar: "application/x-tar", gz: "application/gzip", bin: "application/octet-stream",
    yaml: "text/yaml", yml: "text/yaml", toml: "text/toml", ini: "text/plain",
    sh: "application/x-sh", bat: "application/x-bat", ps1: "application/x-powershell",
    rb: "text/x-ruby", go: "text/x-go", rs: "text/x-rust", swift: "text/x-swift",
    kt: "text/x-kotlin", scala: "text/x-scala"
};

const MULTI_PART_THRESHOLD = 20 * 1024 * 1024; // 20MB

function isSupportedFileType(ext) {
    const e = (ext || "").toLowerCase();
    return Object.values(SUPPORTED_EXTENSIONS).some(arr => arr.includes(e));
}

function getFileCategory(ext) {
    const e = (ext || "").toLowerCase();
    for (const [cat, exts] of Object.entries(SUPPORTED_EXTENSIONS)) {
        if (exts.includes(e)) return cat;
    }
    return "file";
}

function getMimeType(ext) {
    return MIME_TYPES[(ext || "").toLowerCase()] || "application/octet-stream";
}

/**
 * 将上传方法注入到 NotionAPI 对象（避免循环依赖）
 * @param {Object} NotionAPI - NotionAPI 核心对象
 */
function installUploadMethods(NotionAPI) {
    Object.assign(NotionAPI, {
`;

    const footer = `
    });
}

module.exports = { installUploadMethods, isSupportedFileType, getFileCategory, getMimeType, MULTI_PART_THRESHOLD };
`;

    // 处理 upload 方法体：将 "    methodName:" 改为 "        methodName:"
    const body = uploadLines
        .map(line => {
            // 跳过注释行和空行，保持原样
            if (line.trim().startsWith("//") || line.trim() === "") return line;
            // 方法定义行增加缩进
            if (line.match(/^    \w+:/)) {
                return "    " + line;
            }
            return line;
        })
        .join("\n");

    const output = header + body + footer;
    fs.writeFileSync(OUT, output, "utf8");
    console.log("Written:", OUT);

    // 从 index.js 中删除 upload 簇，替换为 require + install
    const before = lines.slice(0, startIdx);
    const after = lines.slice(endIdx);
    
    // 在 before 的末尾添加 require 和 install
    const requireLine = '\nconst { installUploadMethods } = require("./notion-upload");\n';
    
    const newIndex = before.join("\n") + requireLine + "\n" + after.join("\n");
    
    // 备份
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(SRC, path.join(BACKUP_DIR, "api-index.js.bak"));
    
    fs.writeFileSync(SRC, newIndex, "utf8");
    console.log("Updated:", SRC);
    console.log("New LOC:", newIndex.split("\n").length);
    
    // 需要在 NotionAPI 定义结束后调用 installUploadMethods(NotionAPI)
    // 找到 module.exports 行，在其之前插入
    const finalLines = newIndex.split("\n");
    const exportsIdx = finalLines.findIndex(l => l.includes("module.exports"));
    if (exportsIdx !== -1) {
        finalLines.splice(exportsIdx, 0, "// 注入上传方法（T4: notion-upload.js 提取）\ninstallUploadMethods(NotionAPI);\n");
        fs.writeFileSync(SRC, finalLines.join("\n"), "utf8");
        console.log("Added installUploadMethods call before module.exports");
    }
    
    console.log("\nDone! Run 'npx vitest run' to verify.");
}

main();
