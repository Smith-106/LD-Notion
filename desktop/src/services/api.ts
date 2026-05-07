// API 客户端 — 连接 LD-Notion Hub 后端

const API_BASE = "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json();
  if (!data.ok && data.error) {
    throw new Error(data.error);
  }
  return data;
}

// ── 工作区 ──

export interface Workspace {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ data: Workspace[] }>("/api/workspaces");
  return data.data;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const data = await request<{ data: Workspace }>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.data;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await request(`/api/workspaces/${id}`, { method: "DELETE" });
}

// ── 页面 ──

export interface Page {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  file_path: string;
  sort_order: number;
  is_folder: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageContent {
  title: string;
  tags: string[];
  created: string;
  updated: string;
  body: string;
}

export interface PageTreeNode {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  file_path: string;
  sort_order: number;
  is_folder: boolean;
  created_at: string;
  updated_at: string;
  children: PageTreeNode[];
}

export async function createPage(
  workspaceId: string,
  title: string,
  parentId?: string,
): Promise<Page> {
  const body: Record<string, string> = { workspace_id: workspaceId, title };
  if (parentId) body.parent_id = parentId;
  const data = await request<{ data: Page }>("/api/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function getPage(id: string): Promise<Page> {
  const data = await request<{ data: Page }>(`/api/pages/${id}`);
  return data.data;
}

export async function getPageContent(id: string): Promise<PageContent> {
  const data = await request<{ data: PageContent }>(`/api/pages/${id}/content`);
  return data.data;
}

export async function updatePageContent(
  id: string,
  body: string,
): Promise<void> {
  await request(`/api/pages/${id}/content`, {
    method: "PUT",
    body: JSON.stringify({ body }),
  });
}

export async function deletePage(id: string): Promise<void> {
  await request(`/api/pages/${id}`, { method: "DELETE" });
}

export async function getPageTree(
  workspaceId: string,
): Promise<PageTreeNode[]> {
  const data = await request<{ data: PageTreeNode[] }>(
    `/api/workspaces/${workspaceId}/tree`,
  );
  return data.data;
}

// ── 搜索 ──

export interface SearchResult {
  page_id: string;
  title: string;
  snippet: string;
  score: number;
}

export async function searchPages(
  query: string,
  mode: "and" | "or" = "and",
): Promise<SearchResult[]> {
  const data = await request<{ data: { results: SearchResult[] } }>(
    `/api/search?q=${encodeURIComponent(query)}&mode=${mode}`,
  );
  return data.data.results;
}
