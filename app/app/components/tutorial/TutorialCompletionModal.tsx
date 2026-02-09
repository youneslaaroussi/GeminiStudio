"use client";

import { useEffect } from 'react';
import { useTutorialStore } from '@/app/lib/store/tutorial-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

export function TutorialCompletionModal() {
  const { showCompletionModal, getCurrentTutorial, activeTutorialId, tutorials, closeCompletionModal } = useTutorialStore();
  const tutorial = getCurrentTutorial() || (activeTutorialId ? tutorials.get(activeTutorialId) || null : null);

  useEffect(() => {
    if (showCompletionModal) {
      // Small delay to ensure modal is visible before confetti
      const timeoutId = setTimeout(() => {
        // Dynamically import and trigger confetti
        void import('canvas-confetti').then((confettiModule) => {
          const confetti = confettiModule.default;
          const duration = 3000;
          const animationEnd = Date.now() + duration;
          const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10001 };

          function randomInRange(min: number, max: number) {
            return Math.random() * (max - min) + min;
          }

          // Initial burst
          confetti({
            ...defaults,
            particleCount: 100,
            origin: { x: 0.5, y: 0.5 },
          });

          const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
              return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            confetti({
              ...defaults,
              particleCount,
              origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
            });
            confetti({
              ...defaults,
              particleCount,
              origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
            });
          }, 250);

          return () => clearInterval(interval);
        }).catch((err) => {
          console.warn('Confetti library not available', err);
        });
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [showCompletionModal]);

  if (!showCompletionModal) {
    return null;
  }

  // If tutorial is null, use a default message
  const displayTutorial = tutorial || { name: 'the tutorial' };

  return (
    <Dialog open={showCompletionModal} onOpenChange={closeCompletionModal}>
      <DialogContent className="max-w-md z-[10001]">
        <DialogHeader>
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="rounded-full bg-primary/10 p-3">
              <CheckCircle2 className="h-12 w-12 text-primary" />
            </div>
            <DialogTitle className="text-2xl">Tutorial Complete!</DialogTitle>
            <DialogDescription className="text-base">
              You've completed the <strong>{displayTutorial.name}</strong> tutorial. You're all set to start creating amazing videos!
            </DialogDescription>
          </div>
        </DialogHeader>
        <div className="flex justify-center mt-6">
          <Button onClick={closeCompletionModal} size="lg">
            Get Started
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
