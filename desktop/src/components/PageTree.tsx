import { useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "../store/appStore";
import {
  getPageTree,
  getPageContent,
  deletePage,
} from "../services/api";
import "./PageTree.css";

function collectAllIds(nodes: { id: string; children: any[] }[]): string[] {
  const ids: string[] = [];
  function walk(items: typeof nodes) {
    for (const node of items) {
      ids.push(node.id);
      walk(node.children);
    }
  }
  walk(nodes);
  return ids;
}

interface TreeNodeProps {
  node: {
    id: string;
    title: string;
    children: any[];
  };
  depth: number;
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const expandedNodes = useAppStore((s) => s.expandedNodes);
  const toggleNode = useAppStore((s) => s.toggleNode);
  const currentPage = useAppStore((s) => s.currentPage);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setPageTree = useAppStore((s) => s.setPageTree);
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = node.children.length > 0;
  const isActive = currentPage?.id === node.id;

  const handleSelect = useCallback(async () => {
    try {
      const content = await getPageContent(node.id);
      setCurrentPage({ id: node.id, title: content.title, body: content.body, saved: true });
    } catch {
      setCurrentPage({ id: node.id, title: node.title, body: "", saved: true });
    }
  }, [node.id, node.title, setCurrentPage]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm(`删除页面「${node.title}」？`)) return;
      try {
        await deletePage(node.id);
        if (activeWorkspaceId) {
          const tree = await getPageTree(activeWorkspaceId);
          setPageTree(tree);
        }
        if (currentPage?.id === node.id) {
          setCurrentPage(null);
        }
      } catch (err) {
        alert(`删除失败: ${err}`);
      }
    },
    [node.id, node.title, activeWorkspaceId, currentPage, setPageTree, setCurrentPage],
  );

  return (
    <div className="tree-node-container">
      <div
        className={`tree-node ${isActive ? "tree-node-active" : ""}`}
        style={{ paddingLeft: `calc(var(--ldb-spacing-2) + ${depth} * 1rem)` }}
        role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-selected={isActive}
        onClick={handleSelect}
      >
        {hasChildren ? (
          <button
            className="tree-node-chevron"
            onClick={(e) => {
              e.stopPropagation();
              toggleNode(node.id);
            }}
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
              <path d="M3 2h10l-5 8-5-8z" opacity="0.4" />
            </svg>
          )}
        </span>
        <span className="tree-node-label">{node.title}</span>
        <button
          className="tree-node-delete"
          onClick={handleDelete}
          title="删除页面"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
          </svg>
        </button>
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
  const pageTree = useAppStore((s) => s.pageTree);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setPageTree = useAppStore((s) => s.setPageTree);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setPageTree([]);
      return;
    }
    getPageTree(activeWorkspaceId)
      .then((tree) => setPageTree(tree))
      .catch(() => setPageTree([]));
  }, [activeWorkspaceId, setPageTree]);

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return pageTree;
    const lower = searchQuery.toLowerCase();
    function filter(nodes: typeof pageTree): typeof pageTree {
      return nodes
        .map((n) => ({ ...n, children: filter(n.children) }))
        .filter(
          (n) =>
            n.title.toLowerCase().includes(lower) || n.children.length > 0,
        );
    }
    return filter(pageTree);
  }, [pageTree, searchQuery]);

  const handleExpandAll = () => {
    expandAll(collectAllIds(filteredNodes));
  };

  if (!activeWorkspaceId) {
    return (
      <div className="page-tree-empty">
        <p>请先选择或创建工作区</p>
      </div>
    );
  }

  if (filteredNodes.length === 0) {
    return (
      <div className="page-tree-empty">
        <p>{searchQuery ? "未找到匹配的页面" : "暂无页面，点击 + 创建"}</p>
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
      {filteredNodes.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}

export default PageTree;
