"use client";

import { useEffect } from 'react';
import { useTutorialStore } from '@/app/lib/store/tutorial-store';
import { TutorialOverlay } from './TutorialOverlay';
import { TutorialCompletionModal } from './TutorialCompletionModal';
import type { Tutorial } from '@/app/lib/store/tutorial-store';

interface TutorialProviderProps {
  children: React.ReactNode;
  tutorials?: Tutorial[];
}

export function TutorialProvider({ children, tutorials = [] }: TutorialProviderProps) {
  const registerTutorial = useTutorialStore((state) => state.registerTutorial);

  useEffect(() => {
    // Register all provided tutorials
    tutorials.forEach((tutorial) => {
      registerTutorial(tutorial);
    });
  }, [tutorials, registerTutorial]);

  return (
    <>
      {children}
      <TutorialOverlay />
      <TutorialCompletionModal />
    </>
  );
}
