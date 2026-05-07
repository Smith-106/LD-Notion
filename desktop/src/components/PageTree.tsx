import { useMemo } from "react";
import { useAppStore, PageNode } from "../store/appStore";
import "./PageTree.css";

const MOCK_PAGES: PageNode[] = [
  {
    id: "welcome",
    title: "欢迎使用 LD-Notion Hub",
    children: [],
  },
  {
    id: "getting-started",
    title: "快速入门",
    children: [
      {
        id: "gs-install",
        title: "安装与配置",
        children: [
          { id: "gs-install-desktop", title: "桌面客户端", children: [] },
          { id: "gs-install-browser", title: "浏览器扩展", children: [] },
          { id: "gs-install-mcp", title: "MCP 服务配置", children: [] },
        ],
      },
      {
        id: "gs-concepts",
        title: "核心概念",
        children: [
          { id: "gs-concepts-workspace", title: "工作区", children: [] },
          { id: "gs-concepts-page", title: "页面与块", children: [] },
          { id: "gs-concepts-graph", title: "知识图谱", children: [] },
        ],
      },
    ],
  },
  {
    id: "knowledge-base",
    title: "知识库",
    children: [
      {
        id: "kb-tech",
        title: "技术笔记",
        children: [
          { id: "kb-tech-arch", title: "系统架构", children: [] },
          {
            id: "kb-tech-frontend",
            title: "前端开发",
            children: [
              { id: "kb-tech-frontend-react", title: "React 最佳实践", children: [] },
              { id: "kb-tech-frontend-css", title: "CSS 设计模式", children: [] },
            ],
          },
          {
            id: "kb-tech-backend",
            title: "后端开发",
            children: [
              { id: "kb-tech-backend-rust", title: "Rust 笔记", children: [] },
              { id: "kb-tech-backend-api", title: "API 设计", children: [] },
            ],
          },
        ],
      },
      {
        id: "kb-projects",
        title: "项目文档",
        children: [
          { id: "kb-projects-ld-notion", title: "LD-Notion Hub", children: [] },
          { id: "kb-projects-side", title: "辅助项目", children: [] },
        ],
      },
      {
        id: "kb-meetings",
        title: "会议记录",
        children: [],
      },
    ],
  },
  {
    id: "templates",
    title: "模板库",
    children: [
      { id: "tpl-daily", title: "日报模板", children: [] },
      { id: "tpl-weekly", title: "周报模板", children: [] },
      { id: "tpl-review", title: "复盘模板", children: [] },
    ],
  },
];

function flattenNodes(
  nodes: PageNode[],
  query: string
): { node: PageNode; depth: number }[] {
  const result: { node: PageNode; depth: number }[] = [];
  const lowerQuery = query.toLowerCase();

  function walk(items: PageNode[], depth: number) {
    for (const node of items) {
      const titleMatch = node.title.toLowerCase().includes(lowerQuery);
      const hasMatchingChildren = query
        ? flattenNodes(node.children, query).length > 0
        : false;

      if (!query || titleMatch || hasMatchingChildren) {
        result.push({ node, depth });
        if (node.children.length > 0) {
          walk(node.children, depth + 1);
        }
      }
    }
  }

  walk(nodes, 0);
  return result;
}

function collectAllIds(nodes: PageNode[]): string[] {
  const ids: string[] = [];
  function walk(items: PageNode[]) {
    for (const node of items) {
      ids.push(node.id);
      walk(node.children);
    }
  }
  walk(nodes);
  return ids;
}

interface TreeNodeProps {
  node: PageNode;
  depth: number;
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const expandedNodes = useAppStore((s) => s.expandedNodes);
  const toggleNode = useAppStore((s) => s.toggleNode);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = currentPage?.id === node.id;

  return (
    <div className="tree-node-container">
      <div
        className={`tree-node ${isActive ? "tree-node-active" : ""}`}
        style={{ paddingLeft: `calc(var(--ldb-spacing-2) + ${depth} * 1rem)` }}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isActive}
        onClick={() => setCurrentPage({ id: node.id, title: node.title, body: "" })}
      >
        {hasChildren ? (
          <button
            className="tree-node-chevron"
            onClick={() => toggleNode(node.id)}
            aria-label={isExpanded ? "折叠" : "展开"}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`chevron-icon ${isExpanded ? "rotated" : ""}`}
            >
              <path
                d="M6 4l4 4-4 4"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="tree-node-chevron-placeholder" />
        )}
        <span className="tree-node-icon">
          {hasChildren ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              {isExpanded ? (
                <path d="M3 3h4v10H3V3zm6 0h4v10H9V3z" opacity="0.5" />
              ) : (
                <path d="M3 2h10v3H3V2zm0 5h10v3H3V7zm0 5h7v3H3v-3z" opacity="0.5" />
              )}
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M3 2h10l-5 8-5-8z"
                opacity="0.4"
              />
            </svg>
          )}
        </span>
        <span className="tree-node-label">{node.title}</span>
      </div>
      {hasChildren && isExpanded && (
        <div className="tree-node-children" role="group">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function PageTree() {
  const searchQuery = useAppStore((s) => s.searchQuery);
  const expandAll = useAppStore((s) => s.expandAll);

  const filteredNodes = useMemo(
    () => flattenNodes(MOCK_PAGES, searchQuery),
    [searchQuery]
  );

  const handleExpandAll = () => {
    if (searchQuery) {
      const visibleIds = filteredNodes
        .filter(({ node }) => node.children.length > 0)
        .map(({ node }) => node.id);
      expandAll(visibleIds);
    } else {
      expandAll(collectAllIds(MOCK_PAGES));
    }
  };

  if (filteredNodes.length === 0) {
    return (
      <div className="page-tree-empty">
        <p>未找到匹配的页面</p>
      </div>
    );
  }

  return (
    <div className="page-tree" role="tree" aria-label="页面树">
      {searchQuery && (
        <div className="page-tree-search-hint">
          <span>搜索 "{searchQuery}" 的结果</span>
          <button className="expand-all-btn" onClick={handleExpandAll}>
            展开全部
          </button>
        </div>
      )}
      {filteredNodes.map(({ node, depth }) => (
        <TreeNode key={node.id} node={node} depth={depth} />
      ))}
    </div>
  );
}

export default PageTree;
