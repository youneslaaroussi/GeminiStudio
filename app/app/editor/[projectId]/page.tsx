"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Monitor, Copy, Check } from "lucide-react";
import { EditorLayout } from "../../components/editor/EditorLayout";
import { EditorSkeleton } from "../../components/editor/EditorSkeleton";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";
import { getStoredBranchForProject } from "@/app/lib/store/branch-storage";
import { Button } from "@/components/ui/button";

const MOBILE_BREAKPOINT = 768;

interface EditorPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

function EditorMobileCover() {
  const [currentUrl, setCurrentUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCurrentUrl(window.location.href);
    }
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f0f12] p-4">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-slate-800">
          <Monitor className="size-8 text-slate-400" />
        </div>
        <h1 className="text-xl font-semibold text-white mb-2">
          This screen is not supported on mobile
        </h1>
        <p className="text-sm text-slate-400 mb-6">
          Open this project on a desktop or tablet to use the editor.
        </p>
        <div className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2.5 mb-4 text-left">
          <p className="text-xs text-slate-500 mb-1">Current link</p>
          <p className="text-xs sm:text-sm text-slate-300 break-all">
            {currentUrl || "…"}
          </p>
        </div>
        <Button
          onClick={handleCopy}
          className="w-full bg-white text-slate-900 hover:bg-slate-200"
        >
          {copied ? (
            <Check className="size-4 mr-2" />
          ) : (
            <Copy className="size-4 mr-2" />
          )}
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}

export default function EditorPage({ params }: EditorPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { user, loading } = useAuth();
  const { events: analytics } = useAnalytics();
  const loadProject = useProjectStore((s) => s.loadProject);
  const initializeSync = useProjectStore((s) => s.initializeSync);
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
      {user && <EditorLayout key={projectId} />}
      {isMobile && user && <EditorMobileCover />}
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
