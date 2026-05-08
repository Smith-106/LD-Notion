// TipTap 块编辑器 — 支持文本/标题/代码/列表

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { common, createLowlight } from "lowlight";
import { Markdown as tiptapMarkdown } from "tiptap-markdown";
import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../store/appStore";
import { updatePageContent } from "../services/api";
import "./BlockEditor.css";

const lowlight = createLowlight(common);

const SAVE_DEBOUNCE_MS = 1200;

export default function BlockEditor() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPageContent = useAppStore((s) => s.setCurrentPageContent);
  const setCurrentPageSaved = useAppStore((s) => s.setCurrentPageSaved);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPageIdRef = useRef<string | null>(null);

  // 保持 ref 与 store 同步，避免 onUpdate 闭包捕获过时值
  useEffect(() => {
    currentPageIdRef.current = currentPage?.id ?? null;
  }, [currentPage?.id]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({
        placeholder: "开始输入内容，或使用 / 命令…",
      }),
      tiptapMarkdown,
    ],
    editorProps: {
      attributes: {
        class: "block-editor-content",
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const md = (editor.storage as any).markdown.getMarkdown();
        setCurrentPageContent(md);
        const pageId = currentPageIdRef.current;
        if (pageId) {
          updatePageContent(pageId, md).then(
            () => setCurrentPageSaved(true),
            () => {},
          );
        }
      }, SAVE_DEBOUNCE_MS);
    },
  });

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (editor && currentPage?.body != null) {
      const md = currentPage.body;
      if (editor.getHTML() !== md) {
        editor.commands.setContent(md || "");
      }
    }
  }, [currentPage?.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (editor && currentPage) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const md = (editor.storage as any).markdown.getMarkdown();
          setCurrentPageContent(md);
          updatePageContent(currentPage.id, md).then(
            () => setCurrentPageSaved(true),
            () => {},
          );
        }
      }
    },
    [editor, currentPage, setCurrentPageContent, setCurrentPageSaved],
  );

  if (!currentPage) {
    return (
      <div className="editor-page">
        <div className="editor-welcome">
          <div className="editor-welcome-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <h1 className="editor-welcome-title">欢迎使用 LD-Notion Hub</h1>
          <p className="editor-welcome-desc">
            从左侧选择或创建工作区，然后选择页面开始编辑。
          </p>
        </div>
      </div>
    );
  }

  const handleExport = useCallback(() => {
    if (!editor || !currentPage) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown.getMarkdown();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentPage.title || "page"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editor, currentPage]);

  return (
    <div className="block-editor" onKeyDown={handleKeyDown}>
      <div className="block-editor-toolbar">
        <ToolbarButton editor={editor} action="toggleHeading" args={{ level: 1 }} label="H1" />
        <ToolbarButton editor={editor} action="toggleHeading" args={{ level: 2 }} label="H2" />
        <ToolbarButton editor={editor} action="toggleHeading" args={{ level: 3 }} label="H3" />
        <div className="toolbar-separator" />
        <ToolbarButton editor={editor} action="toggleBold" label="B" />
        <ToolbarButton editor={editor} action="toggleItalic" label="I" />
        <ToolbarButton editor={editor} action="toggleCode" label="&lt;/&gt;" />
        <div className="toolbar-separator" />
        <ToolbarButton editor={editor} action="toggleBulletList" label="UL" />
        <ToolbarButton editor={editor} action="toggleOrderedList" label="OL" />
        <ToolbarButton editor={editor} action="toggleCodeBlock" label="Code" />
        <div className="toolbar-separator" />
        <button className="toolbar-btn" onClick={handleExport} title="导出 Markdown">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 11l6 3 6-3M8 2v10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  editor,
  action,
  args,
  label,
}: {
  editor: ReturnType<typeof useEditor>;
  action: string;
  args?: Record<string, unknown>;
  label: string;
}) {
  if (!editor) return null;

  const isActive =
    args && args.level
      ? editor.isActive("heading", args)
      : editor.isActive(action.replace("toggle", "").toLowerCase());

  return (
    <button
      className={`toolbar-btn ${isActive ? "toolbar-btn-active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        const cmd = (editor.chain().focus() as any)[action](args);
        cmd.run();
      }}
      title={label}
    >
      {label}
    </button>
  );
}
