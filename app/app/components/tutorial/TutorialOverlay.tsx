"use client";

import { useEffect, useState, useRef } from 'react';
import { useTutorialStore } from '@/app/lib/store/tutorial-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TutorialCompletionModal } from './TutorialCompletionModal';

export function TutorialOverlay() {
  const {
    isRunning,
    showCompletionModal,
    getCurrentStep,
    getCurrentTutorial,
    hasNextStep,
    hasPreviousStep,
    nextStep,
    previousStep,
    skipTutorial,
    completeTutorial,
  } = useTutorialStore();

  const currentStep = getCurrentStep();
  const tutorial = getCurrentTutorial();
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isElementVisible, setIsElementVisible] = useState(false);
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Find and highlight the target element
  useEffect(() => {
    if (!isRunning || !currentStep) {
      setHighlightRect(null);
      setIsElementVisible(false);
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
      return;
    }

    let hasCalledBeforeStep = false;

    const findAndHighlightElement = async () => {
      // Call onBeforeStep callback first if provided (e.g., to show hidden panels)
      // Only call it once per step
      if (currentStep.onBeforeStep && !hasCalledBeforeStep) {
        hasCalledBeforeStep = true;
        await Promise.resolve(currentStep.onBeforeStep()).catch(console.error);
        // Wait a bit for DOM updates after callback
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      const element = document.querySelector(currentStep.target);
      
      if (element) {
        const rect = element.getBoundingClientRect();
        // Only set visible if element has actual dimensions
        if (rect.width > 0 && rect.height > 0) {
          setHighlightRect(rect);
          setIsElementVisible(true);
          
          // Scroll element into view if needed
          if (currentStep.waitForElement) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
        } else {
          setIsElementVisible(false);
        }
      } else {
        setIsElementVisible(false);
      }
    };

    // Initial check
    void findAndHighlightElement();

    // Check periodically if waiting for element
    if (currentStep.waitForElement) {
      checkIntervalRef.current = setInterval(() => {
        void findAndHighlightElement();
      }, 200);
    }

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
        checkIntervalRef.current = null;
      }
    };
  }, [isRunning, currentStep]);

  // Hide overlay when completion modal is showing or tutorial not running
  if (!isRunning || !currentStep || !tutorial || showCompletionModal) {
    return null;
  }

  const handleNext = () => {
    if (currentStep.onAfterStep) {
      Promise.resolve(currentStep.onAfterStep())
        .then(() => {
          if (hasNextStep()) {
            nextStep();
          } else {
            completeTutorial();
          }
        })
        .catch(console.error);
    } else {
      if (hasNextStep()) {
        nextStep();
      } else {
        completeTutorial();
      }
    }
  };

  const handlePrevious = () => {
    if (hasPreviousStep()) {
      previousStep();
    }
  };

  const handleSkip = () => {
    skipTutorial();
  };

  const isCenterPlacement = currentStep.placement === 'center';

  return (
    <>
      {/* Overlay backdrop */}
      <div
        className="fixed inset-0 z-[9998] pointer-events-none"
        style={{
          background: highlightRect
            ? `radial-gradient(
                ellipse ${highlightRect.width + 40}px ${highlightRect.height + 40}px at ${highlightRect.left + highlightRect.width / 2}px ${highlightRect.top + highlightRect.height / 2}px,
                transparent 0%,
                transparent 60%,
                rgba(0, 0, 0, 0.7) 100%
              )`
            : 'rgba(0, 0, 0, 0.7)',
        }}
      />

      {/* Highlight border */}
      {highlightRect && !isCenterPlacement && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: `${highlightRect.left - 1}px`,
            top: `${highlightRect.top - 1}px`,
            width: `${highlightRect.width + 2}px`,
            height: `${highlightRect.height + 2}px`,
            border: '1px solid rgb(161, 161, 170)',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
          }}
        />
      )}

      {/* Tutorial dialog */}
      <Dialog open={isRunning} onOpenChange={() => {}}>
        <DialogContent
          showCloseButton={false}
          className={cn(
            "pointer-events-auto z-[10000]",
            isCenterPlacement && "max-w-md",
            !isCenterPlacement && highlightRect && [
              currentStep.placement === 'right' && "absolute",
              currentStep.placement === 'left' && "absolute",
              currentStep.placement === 'top' && "absolute",
              currentStep.placement === 'bottom' && "absolute",
            ]
          )}
          style={
            !isCenterPlacement && highlightRect
              ? {
                  position: 'fixed',
                  ...(currentStep.placement === 'right' && {
                    left: `${highlightRect.right + 20}px`,
                    top: `${highlightRect.top + highlightRect.height / 2}px`,
                    transform: 'translateY(-50%)',
                  }),
                  ...(currentStep.placement === 'left' && {
                    right: `${window.innerWidth - highlightRect.left + 20}px`,
                    top: `${highlightRect.top + highlightRect.height / 2}px`,
                    transform: 'translateY(-50%)',
                  }),
                  ...(currentStep.placement === 'top' && {
                    left: `${highlightRect.left + highlightRect.width / 2}px`,
                    bottom: `${window.innerHeight - highlightRect.top + 20}px`,
                    transform: 'translateX(-50%)',
                  }),
                  ...(currentStep.placement === 'bottom' && {
                    left: `${highlightRect.left + highlightRect.width / 2}px`,
                    top: `${highlightRect.bottom + 20}px`,
                    transform: 'translateX(-50%)',
                  }),
                }
              : undefined
          }
        >
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <DialogTitle>{currentStep.title}</DialogTitle>
                <DialogDescription className="mt-2">
                  {typeof currentStep.content === 'string' ? (
                    <p>{currentStep.content}</p>
                  ) : (
                    currentStep.content
                  )}
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSkip}
                className="h-6 w-6 shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Step {tutorial.steps.findIndex((s) => s.id === currentStep.id) + 1} of {tutorial.steps.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevious}
                disabled={!hasPreviousStep()}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                size="sm"
                onClick={handleNext}
                disabled={!isElementVisible && currentStep.waitForElement}
              >
                {hasNextStep() ? (
                  <>
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </>
                ) : (
                  'Finish'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
