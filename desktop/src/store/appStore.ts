import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";

export interface PageNode {
  id: string;
  title: string;
  children: PageNode[];
}

export interface CurrentPage {
  id: string;
  title: string;
  body: string;
}

export type MCPStatus = "connected" | "disconnected" | "error";

interface AppState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  mcpStatus: MCPStatus;
  setMcpStatus: (status: MCPStatus) => void;
  expandedNodes: Set<string>;
  toggleNode: (nodeId: string) => void;
  expandAll: (nodeIds: string[]) => void;
  collapseAll: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  currentPage: CurrentPage | null;
  setCurrentPage: (page: CurrentPage | null) => void;
  setCurrentPageContent: (body: string) => void;
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
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  currentPage: null,
  setCurrentPage: (page) => set({ currentPage: page }),
  setCurrentPageContent: (body) =>
    set((state) => {
      if (!state.currentPage) return state;
      return { currentPage: { ...state.currentPage, body } };
    }),
}));
