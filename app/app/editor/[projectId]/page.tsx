"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { EditorLayout } from "../../components/editor/EditorLayout";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { getStoredBranchForProject } from "@/app/lib/store/branch-storage";

interface EditorPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default function EditorPage({ params }: EditorPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const loadProject = useProjectStore((s) => s.loadProject);
  const initializeSync = useProjectStore((s) => s.initializeSync);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
      return;
    }

    if (user) {
      loadProject(projectId);
      const branchId = getStoredBranchForProject(projectId);
      console.log('[EDITOR] Initializing sync with userId:', user.uid, 'branch:', branchId);
      initializeSync(user.uid, projectId, branchId);
    }
  }, [projectId, loadProject, initializeSync, user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <EditorLayout key={projectId} />;
}
