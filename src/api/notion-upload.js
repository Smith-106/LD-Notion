"use strict";

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
    // 创建文件上传 (single_part ≤ 20MB)
        createFileUpload: async (filename, contentType, apiKey) => {
        return await NotionAPI.request("POST", "/file_uploads", {
            mode: "single_part",
            filename: filename,
            content_type: contentType,
        }, apiKey);
    },

    // 创建多分片上传 (>20MB)
    // numberOfParts (ISS-019/F2)：Notion API multi_part 契约要求声明 number_of_parts(1-10000)，
    // 须与最终 part_number 匹配。Context7 OpenAPI /file_uploads POST mode=multi_part。
        createMultiPartUpload: async (filename, contentType, fileSize, apiKey, numberOfParts) => {
        return await NotionAPI.request("POST", "/file_uploads", {
            mode: "multi_part",
            filename: filename,
            content_type: contentType,
            file_size: fileSize,
            number_of_parts: numberOfParts,
        }, apiKey);
    },

    // 发送分片（ISS-019/F1：multipart/form-data 二进制，对齐 Notion send endpoint 契约）
    // Context7 /websites/developers_notion_reference: send endpoint 用 multipart/form-data（unique to this endpoint），
    // file field 放原始二进制，part_number field(1-1000)。原 base64+JSON 实现违反契约且体积膨胀 33%。
    // 仿 uploadFileContent:931 multipart 模式，但走 Notion API endpoint + Authorization Bearer（非 S3 预签名 URL）。
        sendFilePart: (uploadId, partBlob, partNumber, apiKey, filename) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const boundaryBytes = new Uint8Array(8);
                if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                    crypto.getRandomValues(boundaryBytes);
                } else {
                    reject(new Error("crypto.getRandomValues 不可用，无法生成 multipart boundary"));
                    return;
                }
                const boundary = '----LDNotionFormBoundary' + Array.from(boundaryBytes, b => b.toString(16).padStart(2, "0")).join("");
                const partName = filename || `part-${partNumber}.bin`;
                const uint8Array = new Uint8Array(reader.result);

                const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${partName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
                const partNumberField = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="part_number"\r\n\r\n${partNumber}\r\n`;
                const footer = `--${boundary}--\r\n`;

                const headerBytes = new TextEncoder().encode(fileHeader);
                const partNumberBytes = new TextEncoder().encode(partNumberField);
                const footerBytes = new TextEncoder().encode(footer);

                const body = new Uint8Array(headerBytes.length + uint8Array.length + partNumberBytes.length + footerBytes.length);
                body.set(headerBytes, 0);
                body.set(uint8Array, headerBytes.length);
                body.set(partNumberBytes, headerBytes.length + uint8Array.length);
                body.set(footerBytes, headerBytes.length + uint8Array.length + partNumberBytes.length);

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: NotionAPI.Transport.buildUrl(`/file_uploads/${uploadId}/send`),
                    headers: {
                        'Authorization': `Bearer ${NotionOAuth.getAccessToken(apiKey)}`,
                        'Notion-Version': CONFIG.API.NOTION_VERSION,
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    },
                    data: body.buffer,
                    binary: true,
                    timeout: 120000,
                    onload: (response) => {
                        if (response.status >= 200 && response.status < 300) {
                            try { resolve(Utils.safeJsonParse(response.responseText, {})); }
                            catch { resolve({}); }
                        } else {
                            reject(new Error(`发送分片失败: ${response.status} ${Utils.truncateText(response.responseText || "", 300)}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                    ontimeout: () => reject(new Error("发送分片超时")),
                });
            };
            reader.onerror = () => reject(new Error("读取分片数据失败"));
            reader.readAsArrayBuffer(partBlob);
        });
    },

    // 完成多分片上传
        completeFileUpload: async (uploadId, apiKey) => {
        return await NotionAPI.request("POST", `/file_uploads/${uploadId}/complete`, {}, apiKey);
    },

    // 获取工作区文件大小限制
        getWorkspaceLimits: async (apiKey) => {
        try {
            const user = await NotionAPI.request("GET", "/users/me", null, apiKey);
            return user?.bot?.workspace_limits?.max_file_upload_size_in_bytes || 5 * 1024 * 1024;
        } catch (e) {
            // 补 warn 区分真 5MB 与错误降级（L3 observability），便于诊断大文件上传失败
            console.warn("[LD-Notion] 获取工作区文件大小限制失败，回退到 5MB:", e);
            return 5 * 1024 * 1024; // 默认 5MB (Free 计划)
        }
    },

    // 上传文件内容到预签名 URL
        uploadFileContent: (uploadUrl, blob, contentType, filename) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const bytes = new Uint8Array(8);
                if (typeof crypto !== "undefined" && crypto.getRandomValues) {
                    crypto.getRandomValues(bytes);
                } else {
                    throw new Error("crypto.getRandomValues 不可用，无法生成 multipart boundary");
                }
                const boundary = '----WebKitFormBoundary' + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
                const uint8Array = new Uint8Array(reader.result);

                const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
                const headerBytes = new TextEncoder().encode(header);
                const footerBytes = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);

                const body = new Uint8Array(headerBytes.length + uint8Array.length + footerBytes.length);
                body.set(headerBytes, 0);
                body.set(uint8Array, headerBytes.length);
                body.set(footerBytes, headerBytes.length + uint8Array.length);

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: uploadUrl,
                    headers: {
                        // 预签名 URL 已包含授权信息，发送 API Key 会造成安全泄露
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    },
                    data: body.buffer,
                    binary: true,
                    onload: (response) => {
                        if (response.status === 200 || response.status === 204) {
                            resolve();
                        } else {
                            reject(new Error(`上传文件失败: ${response.status}`));
                        }
                    },
                    onerror: (error) => reject(new Error(`网络请求失败: ${error}`)),
                timeout: 60000,
                ontimeout: () => reject(new Error("文件上传超时")),
                });
            };
            reader.onerror = () => reject(new Error("读取文件数据失败"));
            reader.readAsArrayBuffer(blob);
        });
    },

    // 通用文件上传（支持所有类型：图片/视频/音频/附件）
    // 自动判断 single_part / multi_part，自动识别 block 类型
        uploadFileToNotion: async (fileUrl, apiKey, originalFileName = null) => {
        const urlObj = new URL(fileUrl);
        let ext = (urlObj.pathname.split(".").pop() || "").split("?")[0].toLowerCase();

        // 优先使用原始文件名的扩展名
        if (originalFileName) {
            const origExt = originalFileName.split(".").pop()?.toLowerCase();
            if (origExt && origExt.length <= 10 && /^[a-z0-9]+$/i.test(origExt)) {
                ext = origExt;
            }
        }

        // 校验扩展名格式
        if (!ext || ext.length > 10 || !/^[a-z0-9]+$/i.test(ext)) ext = "bin";

        // 校验文件类型是否被 Notion API 支持
        if (!isSupportedFileType(ext)) {
            throw new Error(`不支持的文件类型: .${ext}`);
        }

        // 下载文件（使用 GM_xmlhttpRequest 避免 CORS 限制）
        const blob = await new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: fileUrl,
                responseType: "blob",
                timeout: 60000,
                onload: (r) => {
                    if (r.status >= 200 && r.status < 300) resolve(r.response);
                    else reject(new Error(`下载失败: ${r.status}`));
                },
                onerror: (e) => reject(new Error(`下载失败: ${e}`)),
                ontimeout: () => reject(new Error("下载超时")),
            });
        });
        const contentType = blob.type || getMimeType(ext);
        const category = getFileCategory(ext);

        // 根据文件类型确定 block 类型和文件名前缀
        let blockType = "image";
        if (category === "video") blockType = "video";
        else if (category === "audio") blockType = "audio";
        else if (category === "file") blockType = "file";

        const filename = originalFileName || `${blockType}-${Date.now()}.${ext}`;

        // 大文件使用 multi_part 模式
        if (blob.size > MULTI_PART_THRESHOLD) {
            const PART_SIZE = 20 * 1024 * 1024; // 每片 20MB
            const totalParts = Math.ceil(blob.size / PART_SIZE);

            // ISS-019/F2：multi_part 契约要求 createMultiPartUpload 声明 number_of_parts
            const multiUpload = await NotionAPI.createMultiPartUpload(
                filename, contentType, blob.size, apiKey, totalParts
            );
            if (!multiUpload?.id) throw new Error("创建多分片上传失败");

            for (let i = 0; i < totalParts; i++) {
                const start = i * PART_SIZE;
                const end = Math.min(start + PART_SIZE, blob.size);
                const partBlob = blob.slice(start, end);

                // ISS-019/F1：sendFilePart 改 multipart/form-data 二进制，直接传 partBlob（不再 readAsDataURL base64）
                await NotionAPI.sendFilePart(multiUpload.id, partBlob, i + 1, apiKey, filename);
            }

            await NotionAPI.completeFileUpload(multiUpload.id, apiKey);
            return { fileId: multiUpload.id, blockType };
        }

        // 普通文件使用 single_part 模式
        const typedBlob = new Blob([blob], { type: contentType });
        const fileUpload = await NotionAPI.createFileUpload(filename, contentType, apiKey);
        if (!fileUpload?.upload_url || !fileUpload?.id) throw new Error("创建上传失败");

        await NotionAPI.uploadFileContent(fileUpload.upload_url, typedBlob, contentType, filename);

        return { fileId: fileUpload.id, blockType };
    },

    // 下载并上传图片到 Notion（保留向后兼容，内部委托给 uploadFileToNotion）
        uploadImageToNotion: async (imageUrl, apiKey, returnDetails = false) => {
        try {
            const result = await NotionAPI.uploadFileToNotion(imageUrl, apiKey);
            if (!returnDetails) return result.fileId;
            return result;
        } catch (error) {
            // 不支持的文件类型或上传失败，尝试按 file block 上传
            if (error.message?.includes("不支持")) {
                console.warn("[LD-Notion] 图片类型不支持，跳过:", imageUrl);
                return null;
            }
            console.warn("[LD-Notion] 图片上传失败:", imageUrl, error.message);
            try {
                // 回退: 按 application/octet-stream 上传为 file block
                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: imageUrl,
                        responseType: "blob",
                        timeout: 60000,
                        onload: (r) => {
                            if (r.status >= 200 && r.status < 300) resolve(r.response);
                            else reject(new Error(`下载失败: ${r.status}`));
                        },
                        onerror: (e) => reject(new Error(`下载失败: ${e}`)),
                        ontimeout: () => reject(new Error("下载超时")),
                    });
                });
                const filename = `file-${Date.now()}.bin`;
                const fileUpload = await NotionAPI.createFileUpload(filename, "application/octet-stream", apiKey);
                if (!fileUpload?.upload_url || !fileUpload?.id) throw new Error("创建上传失败");
                await NotionAPI.uploadFileContent(fileUpload.upload_url, blob, "application/octet-stream", filename);
                const result = { fileId: fileUpload.id, blockType: "file" };
                if (!returnDetails) return result.fileId;
                return result;
            } catch (fallbackError) {
                console.error("[LD-Notion] 文件回退上传失败:", fallbackError);
                return null;
            }
        }
    },

    });
}

module.exports = { installUploadMethods, isSupportedFileType, getFileCategory, getMimeType, MULTI_PART_THRESHOLD };
