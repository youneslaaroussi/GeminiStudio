"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { EditorLayout } from "../../components/editor/EditorLayout";
import { MobileEditorLayout } from "../../components/editor/MobileEditorLayout";
import { EditorSkeleton } from "../../components/editor/EditorSkeleton";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";
import { getStoredBranchForProject } from "@/app/lib/store/branch-storage";

const MOBILE_BREAKPOINT = 768;

interface EditorPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default function EditorPage({ params }: EditorPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const { events: analytics } = useAnalytics();
  const loadProject = useProjectStore((s) => s.loadProject);
  const initializeSync = useProjectStore((s) => s.initializeSync);
  const setUserId = useProjectsListStore((s) => s.setUserId);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
      return;
    }

    if (user) {
      setUserId(user.uid); // Ensure projects list store has userId for Firestore updates (save, etc.)
      loadProject(projectId);
      const branchId = getStoredBranchForProject(projectId);
      console.log('[EDITOR] Initializing sync with userId:', user.uid, 'branch:', branchId);
      initializeSync(user.uid, projectId, branchId);
      analytics.editorOpened({ project_id: projectId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- analytics identity is unstable; we only need to run when auth/project change
  }, [projectId, loadProject, initializeSync, user, loading, router]);

  if (!loading && !user) {
    return null;
  }

  return (
    <>
      {user && !isMobile && <EditorLayout key={projectId} />}
      {user && isMobile && <MobileEditorLayout key={projectId} />}
      <AnimatePresence>
        {loading && (
          <motion.div
            className="absolute inset-0 z-10 h-screen w-full"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <EditorSkeleton />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
