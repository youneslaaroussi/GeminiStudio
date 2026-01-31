"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Upload,
  Trash2,
  FolderOpen,
  Video,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  Clock,
  MoreHorizontal,
  Pencil,
  Play,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectsListStore, ProjectMetadata } from "@/app/lib/store/projects-list-store";
import { useAuth } from "@/app/lib/hooks/useAuth";
import { useAnalytics } from "@/app/lib/hooks/useAnalytics";
import { AppShell } from "@/app/components/layout";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";
type SortOption = "name-asc" | "name-desc" | "date-asc" | "date-desc";

function ProjectsContent() {
  const router = useRouter();
  const { user } = useAuth();
  const { events: analytics } = useAnalytics();
  const projects = useProjectsListStore((s) => s.projects);
  const addProject = useProjectsListStore((s) => s.addProject);
  const removeProject = useProjectsListStore((s) => s.removeProject);
  const importProject = useProjectsListStore((s) => s.importProject);
  const loadProjects = useProjectsListStore((s) => s.loadProjects);
  const setUserId = useProjectsListStore((s) => s.setUserId);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [projectsToDelete, setProjectsToDelete] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [sortOption, setSortOption] = useState<SortOption>("date-desc");

  useEffect(() => {
    if (user) {
      setUserId(user.uid);
      loadProjects(user.uid);
    }
  }, [user, loadProjects, setUserId]);

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    let filtered = projects;
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(query));
    }
    
    // Sort projects
    const sorted = [...filtered].sort((a, b) => {
      switch (sortOption) {
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        case "date-asc":
          return a.lastModified - b.lastModified;
        case "date-desc":
        default:
          return b.lastModified - a.lastModified;
      }
    });
    
    return sorted;
  }, [projects, searchQuery, sortOption]);

  // Check if all visible projects are selected
  const allSelected = filteredAndSortedProjects.length > 0 && 
    filteredAndSortedProjects.every((p) => selectedProjects.has(p.id));
  
  // Check if some (but not all) projects are selected
  const someSelected = filteredAndSortedProjects.some((p) => selectedProjects.has(p.id)) && !allSelected;

  // Handle keyboard shortcuts: ESC to deselect all, Ctrl/Cmd+A to select all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC: Deselect all
      if (e.key === "Escape" && selectedProjects.size > 0) {
        setSelectedProjects(new Set());
      }
      
      // Ctrl/Cmd+A: Select all visible projects
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && filteredAndSortedProjects.length > 0) {
        e.preventDefault(); // Prevent browser's default select all text behavior
        
        // Select all visible projects
        const allVisibleSelected = filteredAndSortedProjects.every((p) => selectedProjects.has(p.id));
        if (allVisibleSelected) {
          // Deselect all visible projects
          setSelectedProjects((prev) => {
            const next = new Set(prev);
            filteredAndSortedProjects.forEach((p) => next.delete(p.id));
            return next;
          });
        } else {
          // Select all visible projects
          setSelectedProjects((prev) => {
            const next = new Set(prev);
            filteredAndSortedProjects.forEach((p) => next.add(p.id));
            return next;
          });
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedProjects, filteredAndSortedProjects]);

  const handleNewProject = async () => {
    if (!user) return;
    const id = crypto.randomUUID();
    const metadata: ProjectMetadata = {
      id,
      name: "New Project",
      lastModified: Date.now(),
    };
    await addProject(metadata, user.uid);
    analytics.projectCreated({ project_id: id, project_name: metadata.name });
    router.push(`/editor/${id}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const id = await importProject(file, user.uid);
      analytics.projectImported({ project_id: id });
      router.push(`/editor/${id}`);
    } catch (err) {
      console.error("Import failed", err);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setProjectToDelete(id);
  };

  const handleDeleteAllClick = () => {
    const selected = Array.from(selectedProjects);
    if (selected.length > 0) {
      setProjectsToDelete(selected);
    }
  };

  const confirmDelete = async () => {
    if (projectToDelete) {
      analytics.projectDeleted({ project_id: projectToDelete });
      await removeProject(projectToDelete);
      setProjectToDelete(null);
      setSelectedProjects((prev) => {
        const next = new Set(prev);
        next.delete(projectToDelete);
        return next;
      });
    }
  };

  const confirmDeleteAll = async () => {
    if (projectsToDelete.length > 0) {
      for (const id of projectsToDelete) {
        analytics.projectDeleted({ project_id: id });
        await removeProject(id);
      }
      setProjectsToDelete([]);
      setSelectedProjects(new Set());
    }
  };

  const handleSelectAll = () => {
    if (allSelected) {
      // Deselect all visible projects
      setSelectedProjects((prev) => {
        const next = new Set(prev);
        filteredAndSortedProjects.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      // Select all visible projects
      setSelectedProjects((prev) => {
        const next = new Set(prev);
        filteredAndSortedProjects.forEach((p) => next.add(p.id));
        return next;
      });
    }
  };

  const handleToggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCardClick = (e: React.MouseEvent, id: string) => {
    // If selection mode is active (any projects selected), toggle selection instead of navigating
    if (selectedProjects.size > 0) {
      handleToggleSelect(e, id);
    } else {
      const project = projects.find((p) => p.id === id);
      analytics.projectOpened({ project_id: id, project_name: project?.name });
      router.push(`/editor/${id}`);
    }
  };

  const handleRefresh = async () => {
    if (!user) return;
    setIsRefreshing(true);
    try {
      await loadProjects(user.uid);
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  const projectToDeleteName = projectToDelete
    ? projects.find((p) => p.id === projectToDelete)?.name
    : null;

  const selectedCount = selectedProjects.size;

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      {/* Hero Section */}
      <div className="border-b border-slate-800 bg-gradient-to-b from-slate-900/50 to-transparent">
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Your Projects</h1>
              <p className="text-slate-400">
                Create and manage AI-assisted video timelines
              </p>
            </div>
            <Button
              onClick={handleNewProject}
              className="bg-white text-black hover:bg-slate-100 shadow-lg shadow-white/5"
            >
              <Plus className="size-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Toolbar */}
        <div className="flex items-center gap-4 mb-6">
          {/* Select All Checkbox */}
          {filteredAndSortedProjects.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSelectAll}
                className={cn(
                  "flex items-center justify-center w-5 h-5 rounded border transition-colors",
                  allSelected
                    ? "bg-white border-white text-slate-900"
                    : someSelected
                    ? "bg-white/50 border-white/50 text-slate-900"
                    : "border-slate-600 hover:border-slate-500"
                )}
              >
                {allSelected && <Check className="size-3.5" />}
                {someSelected && <div className="w-2 h-2 bg-slate-900 rounded-sm" />}
              </button>
              {selectedCount > 0 && (
                <span className="text-sm text-slate-400">
                  {selectedCount} {selectedCount === 1 ? "selected" : "selected"}
                </span>
              )}
            </div>
          )}

          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects..."
              className="pl-10 bg-slate-900 border-slate-800 text-white placeholder:text-slate-500 focus:border-slate-700"
            />
          </div>

          {/* Sort Dropdown */}
          {filteredAndSortedProjects.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  Sort by
                  <ChevronDown className="size-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700">
                <DropdownMenuItem
                  onClick={() => setSortOption("name-asc")}
                  className={cn(
                    "text-slate-300 focus:text-white focus:bg-slate-800",
                    sortOption === "name-asc" && "bg-slate-800"
                  )}
                >
                  Name (A-Z)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortOption("name-desc")}
                  className={cn(
                    "text-slate-300 focus:text-white focus:bg-slate-800",
                    sortOption === "name-desc" && "bg-slate-800"
                  )}
                >
                  Name (Z-A)
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  onClick={() => setSortOption("date-desc")}
                  className={cn(
                    "text-slate-300 focus:text-white focus:bg-slate-800",
                    sortOption === "date-desc" && "bg-slate-800"
                  )}
                >
                  Date (Newest)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSortOption("date-asc")}
                  className={cn(
                    "text-slate-300 focus:text-white focus:bg-slate-800",
                    sortOption === "date-asc" && "bg-slate-800"
                  )}
                >
                  Date (Oldest)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Delete All Button */}
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteAllClick}
              className="bg-red-600 hover:bg-red-700"
            >
              <Trash2 className="size-4 mr-2" />
              Delete ({selectedCount})
            </Button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {/* Refresh */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
            </Button>

            {/* View Toggle */}
            <div className="flex items-center rounded-lg border border-slate-800 p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === "grid"
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-white"
                )}
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  viewMode === "list"
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-white"
                )}
              >
                <List className="size-4" />
              </button>
            </div>

            {/* Import */}
            <label>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <span>
                  <Upload className="size-4 mr-2" />
                  Import
                </span>
              </Button>
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
          </div>
        </div>

        {/* Projects */}
        {filteredAndSortedProjects.length > 0 ? (
          <>
            {/* Results count */}
            {searchQuery && (
              <p className="text-sm text-slate-500 mb-4">
                {filteredAndSortedProjects.length} {filteredAndSortedProjects.length === 1 ? "result" : "results"} for "{searchQuery}"
              </p>
            )}

            {viewMode === "grid" ? (
              /* Grid View */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredAndSortedProjects.map((project) => {
                  const isSelected = selectedProjects.has(project.id);
                  return (
                  <div
                    key={project.id}
                    onClick={(e) => handleCardClick(e, project.id)}
                    className={cn(
                      "group cursor-pointer relative",
                      isSelected && "ring-2 ring-white ring-offset-2 ring-offset-slate-900 rounded-xl"
                    )}
                  >
                    <div className={cn(
                      "overflow-hidden rounded-xl border bg-slate-900/50 hover:border-slate-700 hover:bg-slate-900 transition-all duration-200 hover:shadow-xl hover:shadow-black/20",
                      isSelected ? "border-white" : "border-slate-800"
                    )}>
                      {/* Checkbox */}
                      <div className="absolute top-2 left-2 z-10">
                        <button
                          onClick={(e) => handleToggleSelect(e, project.id)}
                          className={cn(
                            "flex items-center justify-center w-5 h-5 rounded border transition-colors backdrop-blur-sm",
                            isSelected
                              ? "bg-white border-white text-slate-900"
                              : "bg-black/50 border-white/50 hover:bg-black/70 hover:border-white"
                          )}
                        >
                          {isSelected && <Check className="size-3.5" />}
                        </button>
                      </div>
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-slate-950 overflow-hidden">
                        {project.thumbnail ? (
                          <img
                            src={project.thumbnail}
                            alt={project.name}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-900 to-slate-950">
                            <div className="p-4 rounded-full bg-slate-800/50">
                              <Video className="size-8 text-slate-600" />
                            </div>
                          </div>
                        )}
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="flex items-center gap-2 text-sm font-medium text-white bg-white/20 backdrop-blur-sm px-4 py-2 rounded-full">
                            <Play className="size-4" />
                            Open
                          </span>
                        </div>
                        {/* Menu */}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                              >
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700">
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  analytics.projectOpened({ project_id: project.id, project_name: project.name });
                                  router.push(`/editor/${project.id}`);
                                }}
                                className="text-slate-300 focus:text-white focus:bg-slate-800"
                              >
                                <Pencil className="size-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-slate-700" />
                              <DropdownMenuItem
                                onClick={(e) => handleDeleteClick(e, project.id)}
                                className="text-red-400 focus:text-red-300 focus:bg-red-500/10"
                              >
                                <Trash2 className="size-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Info */}
                      <div className="p-4">
                        <h3 className="font-medium text-white truncate mb-1">
                          {project.name}
                        </h3>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Clock className="size-3" />
                          {formatRelativeTime(project.lastModified)}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              /* List View */
              <div className="rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800">
                {filteredAndSortedProjects.map((project) => {
                  const isSelected = selectedProjects.has(project.id);
                  return (
                  <div
                    key={project.id}
                    onClick={(e) => handleCardClick(e, project.id)}
                    className={cn(
                      "flex items-center gap-4 p-4 cursor-pointer transition-colors group",
                      isSelected
                        ? "bg-slate-800 border-l-4 border-l-white"
                        : "bg-slate-900/50 hover:bg-slate-900"
                    )}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => handleToggleSelect(e, project.id)}
                      className={cn(
                        "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                        isSelected
                          ? "bg-white border-white text-slate-900"
                          : "border-slate-600 hover:border-slate-500"
                      )}
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </button>
                    {/* Thumbnail */}
                    <div className="w-32 h-20 rounded-lg overflow-hidden bg-slate-950 shrink-0">
                      {project.thumbnail ? (
                        <img
                          src={project.thumbnail}
                          alt={project.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full bg-gradient-to-br from-slate-900 to-slate-950">
                          <Video className="size-6 text-slate-600" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-white truncate mb-1">
                        {project.name}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" />
                          {formatRelativeTime(project.lastModified)}
                        </span>
                        <span>
                          {new Date(project.lastModified).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          analytics.projectOpened({ project_id: project.id, project_name: project.name });
                          router.push(`/editor/${project.id}`);
                        }}
                        className="text-slate-400 hover:text-white hover:bg-slate-800"
                      >
                        <Play className="size-4 mr-2" />
                        Open
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => e.stopPropagation()}
                            className="text-slate-400 hover:text-white hover:bg-slate-800"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-slate-900 border-slate-700">
                          <DropdownMenuItem
                            onClick={(e) => handleDeleteClick(e, project.id)}
                            className="text-red-400 focus:text-red-300 focus:bg-red-500/10"
                          >
                            <Trash2 className="size-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </>
        ) : projects.length > 0 && searchQuery ? (
          /* No search results */
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mb-4">
              <Search className="size-7 text-slate-600" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No results found</h3>
            <p className="text-sm text-slate-400 text-center max-w-sm mb-4">
              No projects match "{searchQuery}". Try a different search term.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              Clear search
            </Button>
          </div>
        ) : (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center border border-slate-700">
                <Video className="size-10 text-slate-500" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-lg">
                <Plus className="size-5 text-slate-900" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Create your first project</h3>
            <p className="text-sm text-slate-400 text-center max-w-md mb-8">
              Start building AI-assisted video timelines. Import existing projects or create a new one from scratch.
            </p>
            <div className="flex gap-3">
              <label>
                <Button
                  variant="outline"
                  asChild
                  className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <span>
                    <Upload className="size-4 mr-2" />
                    Import Project
                  </span>
                </Button>
                <input type="file" accept=".json" className="hidden" onChange={handleImport} />
              </label>
              <Button
                onClick={handleNewProject}
                className="bg-white text-black hover:bg-slate-100"
              >
                <Plus className="size-4 mr-2" />
                New Project
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={projectToDelete !== null} onOpenChange={(open) => !open && setProjectToDelete(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Delete project</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete{" "}
              <span className="text-slate-300 font-medium">"{projectToDeleteName}"</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setProjectToDelete(null)}
              className="text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={projectsToDelete.length > 0} onOpenChange={(open) => !open && setProjectsToDelete([])}>
        <DialogContent className="bg-slate-900 border-slate-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Delete projects</DialogTitle>
            <DialogDescription className="text-slate-400">
              Are you sure you want to delete {projectsToDelete.length} {projectsToDelete.length === 1 ? "project" : "projects"}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setProjectsToDelete([])}
              className="text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteAll}>
              Delete {projectsToDelete.length} {projectsToDelete.length === 1 ? "project" : "projects"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <AppShell>
      <ProjectsContent />
    </AppShell>
  );
}
