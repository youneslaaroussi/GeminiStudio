"use client";

import { use, useEffect } from "react";
import { EditorLayout } from "../../components/editor/EditorLayout";
import { useProjectStore } from "@/app/lib/store/project-store";
import { useProjectsListStore } from "@/app/lib/store/projects-list-store";

interface EditorPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default function EditorPage({ params }: EditorPageProps) {
  const { projectId } = use(params);
  const loadProject = useProjectStore((s) => s.loadProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const currentProjectId = useProjectStore((s) => s.projectId);
  const project = useProjectStore((s) => s.project);
  const updateListProject = useProjectsListStore((s) => s.updateProject);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  return <EditorLayout key={projectId} />;
}
