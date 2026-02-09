import { create } from 'zustand';

export type TutorialId = string;

export interface TutorialStep {
  id: string;
  target: string; // CSS selector or data attribute
  title: string;
  content: string | React.ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  onBeforeStep?: () => void | Promise<void>;
  onAfterStep?: () => void | Promise<void>;
  waitForElement?: boolean; // Wait for element to be visible before showing step
}

export interface Tutorial {
  id: TutorialId;
  name: string;
  description?: string;
  steps: TutorialStep[];
}

interface TutorialStore {
  // Current tutorial state
  activeTutorialId: TutorialId | null;
  currentStepIndex: number;
  isRunning: boolean;
  showCompletionModal: boolean;
  
  // Tutorial registry
  tutorials: Map<TutorialId, Tutorial>;
  
  // Expose tutorials map for direct access
  
  // Actions
  registerTutorial: (tutorial: Tutorial) => void;
  startTutorial: (tutorialId: TutorialId) => void;
  nextStep: () => void;
  previousStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
  closeCompletionModal: () => void;
  
  // Getters
  getCurrentTutorial: () => Tutorial | null;
  getCurrentStep: () => TutorialStep | null;
  hasNextStep: () => boolean;
  hasPreviousStep: () => boolean;
}

export const useTutorialStore = create<TutorialStore>((set, get) => ({
  activeTutorialId: null,
  currentStepIndex: 0,
  isRunning: false,
  showCompletionModal: false,
  tutorials: new Map(),

  registerTutorial: (tutorial) => {
    set((state) => {
      const tutorials = new Map(state.tutorials);
      tutorials.set(tutorial.id, tutorial);
      return { tutorials };
    });
  },

  startTutorial: (tutorialId) => {
    const tutorial = get().tutorials.get(tutorialId);
    if (!tutorial) {
      console.warn(`Tutorial ${tutorialId} not found`);
      return;
    }
    set({
      activeTutorialId: tutorialId,
      currentStepIndex: 0,
      isRunning: true,
    });
  },

  nextStep: () => {
    const state = get();
    const tutorial = state.getCurrentTutorial();
    if (!tutorial) return;

    if (state.currentStepIndex < tutorial.steps.length - 1) {
      set({ currentStepIndex: state.currentStepIndex + 1 });
    } else {
      get().completeTutorial();
    }
  },

  previousStep: () => {
    const state = get();
    if (state.currentStepIndex > 0) {
      set({ currentStepIndex: state.currentStepIndex - 1 });
    }
  },

  skipTutorial: () => {
    set({
      activeTutorialId: null,
      currentStepIndex: 0,
      isRunning: false,
    });
  },

  completeTutorial: () => {
    const state = get();
    const tutorialId = state.activeTutorialId;
    const tutorial = state.getCurrentTutorial();
    
    if (tutorialId) {
      // Store completion in localStorage
      if (typeof window !== 'undefined') {
        const completed = JSON.parse(
          localStorage.getItem('tutorial-completed') || '[]'
        ) as string[];
        if (!completed.includes(tutorialId)) {
          completed.push(tutorialId);
          localStorage.setItem('tutorial-completed', JSON.stringify(completed));
        }
      }
    }
    
    // Keep tutorial ID so completion modal can access it
    set({
      isRunning: false,
      showCompletionModal: true,
      // Keep activeTutorialId so getCurrentTutorial() still works
    });
  },

  closeCompletionModal: () => {
    set({
      activeTutorialId: null,
      currentStepIndex: 0,
      isRunning: false,
      showCompletionModal: false,
    });
  },

  getCurrentTutorial: () => {
    const state = get();
    if (!state.activeTutorialId) return null;
    return state.tutorials.get(state.activeTutorialId) || null;
  },

  getCurrentStep: () => {
    const tutorial = get().getCurrentTutorial();
    if (!tutorial) return null;
    return tutorial.steps[get().currentStepIndex] || null;
  },

  hasNextStep: () => {
    const state = get();
    const tutorial = state.getCurrentTutorial();
    if (!tutorial) return false;
    return state.currentStepIndex < tutorial.steps.length - 1;
  },

  hasPreviousStep: () => {
    return get().currentStepIndex > 0;
  },
}));
