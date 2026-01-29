/**
 * Persist and read the selected branch per project so we load the correct branch on next visit.
 * Uses localStorage key: gemini-studio-branch-{projectId}
 */

const STORAGE_PREFIX = "gemini-studio-branch-";

export function getStoredBranchForProject(projectId: string): string {
  if (typeof window === "undefined") return "main";
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + projectId);
    return stored && stored.trim() ? stored.trim() : "main";
  } catch {
    return "main";
  }
}

export function setStoredBranchForProject(projectId: string, branchId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + projectId, branchId);
  } catch {
    // ignore quota / private mode
  }
}
