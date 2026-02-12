#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def count_occurrences(haystack: str, needle: str) -> int:
    if not needle:
        return 0
    return haystack.count(needle)


def extract_method_body(source: str, object_name: str, method_name: str) -> str | None:
    anchor = f"const {object_name} = {{"
    start = source.find(anchor)
    if start == -1:
        return None
    sub = source[start:]

    m = re.search(
        rf"{re.escape(method_name)}:\s*\(\)\s*=>\s*\{{([\s\S]*?)\n\s*\}},",
        sub,
        flags=re.M,
    )
    if not m:
        return None
    return m.group(1)


def main() -> int:
    target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd() / "LinuxDo-Bookmarks-to-Notion.user.js"
    if not target.exists():
        print(f"❌ 找不到目标 userscript: {target}", file=sys.stderr)
        return 1

    source = target.read_text(encoding="utf-8")
    errors: list[str] = []

    def expect(desc: str, ok: bool, details: str = "") -> None:
        if ok:
            return
        errors.append(f"{desc}: {details}" if details else desc)

    expect("缺少 StyleManager.injectOnce", "injectOnce: (styleId, cssText) => {" in source)
    expect("缺少 DesignSystem.STYLE_IDS.BASE", 'BASE: "ldb-ui-base"' in source)
    expect("缺少 DesignSystem.STYLE_IDS.CHAT", 'CHAT: "ldb-ui-chat"' in source)
    expect("缺少 tokens 标识 LDB_UI_TOKENS", "/* LDB_UI_TOKENS */" in source)
    expect("缺少 ChatUI 样式标识 LDB_UI_CHAT", "/* LDB_UI_CHAT */" in source)
    chat_marker_count = count_occurrences(source, "/* LDB_UI_CHAT */")
    expect("ChatUI 样式标识重复（应为 1 处）", chat_marker_count == 1, f"count={chat_marker_count}")

    notion_inject = extract_method_body(source, "NotionSiteUI", "injectStyles")
    expect("无法提取 NotionSiteUI.injectStyles()", notion_inject is not None)
    if notion_inject is not None:
        expect("NotionSiteUI.injectStyles 未调用 DesignSystem.ensureBase()", "DesignSystem.ensureBase();" in notion_inject)
        expect("NotionSiteUI.injectStyles 未调用 DesignSystem.ensureChat()", "DesignSystem.ensureChat();" in notion_inject)
        expect(
            "NotionSiteUI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.NOTION)",
            "StyleManager.injectOnce(DesignSystem.STYLE_IDS.NOTION" in notion_inject,
        )
        expect(
            "NotionSiteUI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            'document.createElement("style")' not in notion_inject,
        )

    ui_inject = extract_method_body(source, "UI", "injectStyles")
    expect("无法提取 UI.injectStyles()", ui_inject is not None)
    if ui_inject is not None:
        expect("UI.injectStyles 未调用 DesignSystem.ensureBase()", "DesignSystem.ensureBase();" in ui_inject)
        expect("UI.injectStyles 未调用 DesignSystem.ensureChat()", "DesignSystem.ensureChat();" in ui_inject)
        expect(
            "UI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO)",
            "StyleManager.injectOnce(DesignSystem.STYLE_IDS.LINUX_DO" in ui_inject,
        )
        expect(
            "UI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            'document.createElement("style")' not in ui_inject,
        )

    generic_inject = extract_method_body(source, "GenericUI", "injectStyles")
    expect("无法提取 GenericUI.injectStyles()", generic_inject is not None)
    if generic_inject is not None:
        expect("GenericUI.injectStyles 未调用 DesignSystem.ensureBase()", "DesignSystem.ensureBase();" in generic_inject)
        expect(
            "GenericUI.injectStyles 未使用 StyleManager.injectOnce(DesignSystem.STYLE_IDS.GENERIC)",
            "StyleManager.injectOnce(DesignSystem.STYLE_IDS.GENERIC" in generic_inject,
        )
        expect(
            "GenericUI.injectStyles 仍在使用 document.createElement(\"style\")（应改为 StyleManager）",
            'document.createElement("style")' not in generic_inject,
        )

    expect("缺少 prefers-reduced-motion 适配", "@media (prefers-reduced-motion: reduce)" in source)
    expect("缺少 :focus-visible 焦点环样式", ":focus-visible" in source)

    if errors:
        print("❌ UI 静态验证失败：", file=sys.stderr)
        for e in errors:
            print(f"- {e}", file=sys.stderr)
        return 1

    rel = os.path.relpath(str(target), str(Path.cwd()))
    print("✅ UI 静态验证通过")
    print(f"- userscript: {rel}")
    print("- 关键锚点：tokens、chat、三处 injectStyles 注入点已校验")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

