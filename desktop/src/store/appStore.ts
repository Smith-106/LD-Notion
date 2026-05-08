import { create } from "zustand";
import type { PageTreeNode, SearchResult, TagInfo, Workspace } from "../services/api";

export type ThemeMode = "light" | "dark" | "auto";

export type MCPStatus = "connected" | "disconnected" | "error";

export interface CurrentPage {
  id: string;
  title: string;
  body: string;
  saved: boolean;
}

interface AppState {
  // 主题
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;

  // MCP 状态
  mcpStatus: MCPStatus;
  setMcpStatus: (status: MCPStatus) => void;

  // 工作区
  workspaces: Workspace[];
  setWorkspaces: (workspaces: Workspace[]) => void;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;

  // 页面树
  pageTree: PageTreeNode[];
  setPageTree: (tree: PageTreeNode[]) => void;

  // 展开状态
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  expandAll: (nodeIds: string[]) => void;
  collapseAll: () => void;

  // 搜索
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;

  // 当前页面
  currentPage: CurrentPage | null;
  setCurrentPage: (page: CurrentPage | null) => void;
  setCurrentPageContent: (body: string) => void;
  setCurrentPageSaved: (saved: boolean) => void;

  // 标签
  workspaceTags: TagInfo[];
  setWorkspaceTags: (tags: TagInfo[]) => void;
  currentTags: string[];
  setCurrentTags: (tags: string[]) => void;
  tagFilter: string | null;
  setTagFilter: (tag: string | null) => void;
}

function loadTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem("ldb-theme");
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // localStorage 不可用时忽略
  }
  return "auto";
}

function loadActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem("ldb-active-workspace");
  } catch {
    return null;
  }
}

export const useAppStore = create<AppState>((set) => ({
  theme: loadTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem("ldb-theme", theme);
    } catch {
      // localStorage 不可用时忽略
    }
    set({ theme });
  },

  mcpStatus: "disconnected",
  setMcpStatus: (mcpStatus) => set({ mcpStatus }),

  workspaces: [],
  setWorkspaces: (workspaces) => set({ workspaces }),
  activeWorkspaceId: loadActiveWorkspaceId(),
  setActiveWorkspaceId: (id) => {
    try {
      if (id) localStorage.setItem("ldb-active-workspace", id);
      else localStorage.removeItem("ldb-active-workspace");
    } catch {
      // ignore
    }
    set({ activeWorkspaceId: id, currentPage: null });
  },

  pageTree: [],
  setPageTree: (pageTree) => set({ pageTree }),

  expandedNodes: new Set<string>(),
  toggleNode: (nodeId) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return { expandedNodes: next };
    }),
  expandAll: (nodeIds) =>
    set((state) => {
      const next = new Set(state.expandedNodes);
      nodeIds.forEach((id) => next.add(id));
      return { expandedNodes: next };
    }),
  collapseAll: () => set({ expandedNodes: new Set() }),

  searchQuery: "",
  setSearchQuery: (searchQuery) => set({ searchQuery, ...(searchQuery === "" ? { searchResults: [] } : {}) }),
  searchResults: [],
  setSearchResults: (searchResults) => set({ searchResults }),

  currentPage: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setCurrentPageContent: (body) =>
    set((state) => {
      if (!state.currentPage) return state;
      return { currentPage: { ...state.currentPage, body, saved: false } };
    }),
  setCurrentPageSaved: (saved) =>
    set((state) => {
      if (!state.currentPage) return state;
      return { currentPage: { ...state.currentPage, saved } };
    }),

  workspaceTags: [],
  setWorkspaceTags: (workspaceTags) => set({ workspaceTags }),
  currentTags: [],
  setCurrentTags: (currentTags) => set({ currentTags }),
  tagFilter: null,
  setTagFilter: (tagFilter) => set({ tagFilter }),
}));
