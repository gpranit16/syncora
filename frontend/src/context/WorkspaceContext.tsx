import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Workspace } from '../api/workspaces';
import { getWorkspaces } from '../api/workspaces';
import { useAuth } from './AuthContext';

interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspace: (w: Workspace) => void;
  refreshWorkspaces: () => Promise<void>;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshWorkspaces = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const { data } = await getWorkspaces();
      setWorkspaces(data.workspaces);
      if (!activeWorkspace && data.workspaces.length > 0) {
        const storedWorkspaceId = localStorage.getItem('activeWorkspaceId');
        const storedWorkspace = storedWorkspaceId
          ? data.workspaces.find((ws) => ws.workspace_id === Number(storedWorkspaceId))
          : null;
        setActiveWorkspace(storedWorkspace || data.workspaces[0]);
      }
    } catch (err) {
      console.error('Failed to fetch workspaces:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, activeWorkspace]);

  useEffect(() => {
    refreshWorkspaces();
  }, [isAuthenticated]);

  const setActiveWorkspaceWithPersist = (workspace: Workspace) => {
    localStorage.setItem('activeWorkspaceId', String(workspace.workspace_id));
    setActiveWorkspace(workspace);
  };

  return (
    <WorkspaceContext.Provider value={{ workspaces, activeWorkspace, setActiveWorkspace: setActiveWorkspaceWithPersist, refreshWorkspaces, loading }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
};
