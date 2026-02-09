import type { Tutorial } from '@/app/lib/store/tutorial-store';

export const editorTutorial: Tutorial = {
  id: 'editor-intro',
  name: 'Editor Introduction',
  description: 'Learn the basics of the Gemini Studio editor',
  steps: [
    {
      id: 'welcome',
      target: 'body',
      title: 'Welcome to Gemini Studio!',
      content: 'This tutorial will help you get familiar with the editor interface. Let\'s start by exploring the main areas.',
      placement: 'center',
    },
    {
      id: 'assets-panel',
      target: '[data-tutorial="assets-panel"]',
      title: 'Assets Panel',
      content: 'This is where you can upload and manage all your media assets - videos, images, audio, and more. You can also browse templates and components here.',
      placement: 'right',
      waitForElement: true,
    },
    {
      id: 'preview-panel',
      target: '[data-tutorial="preview-panel"]',
      title: 'Preview Panel',
      content: 'Watch your project come to life in real-time. The preview shows exactly how your final video will look.',
      placement: 'left',
      waitForElement: true,
    },
    {
      id: 'timeline-panel',
      target: '[data-tutorial="timeline-panel"]',
      title: 'Timeline',
      content: 'The timeline is where you arrange and edit your clips. Drag clips here to add them to your project.',
      placement: 'top',
      waitForElement: true,
    },
    {
      id: 'right-panel',
      target: '[data-tutorial="right-panel"]',
      title: 'Toolbox & Chat',
      content: 'Use the Toolbox to add elements, or chat with AI to get help creating your project. Switch between tabs to access different tools.',
      placement: 'left',
      waitForElement: true,
      onBeforeStep: () => {
        // Ensure right panel is visible by switching to a layout that shows it
        const rightPanelElement = document.querySelector('[data-tutorial="right-panel"]');
        if (!rightPanelElement) {
          // Panel not visible, trigger layout change
          const event = new CustomEvent('tutorial-ensure-right-panel');
          window.dispatchEvent(event);
          // Wait a bit for layout to update
          return new Promise((resolve) => setTimeout(resolve, 300));
        }
      },
    },
    {
      id: 'chat-input',
      target: '[data-tutorial="chat-input"]',
      title: 'Send Your First Message',
      content: 'We just sent a message for you! Watch the AI add a title card to your project. You can type your own messages here anytime.',
      placement: 'top',
      waitForElement: true,
      onBeforeStep: () => {
        // Ensure right panel is visible
        const rightPanelElement = document.querySelector('[data-tutorial="right-panel"]');
        if (!rightPanelElement) {
          const event = new CustomEvent('tutorial-ensure-right-panel');
          window.dispatchEvent(event);
        }

        // Switch to chat tab
        const switchToChatEvent = new CustomEvent('tutorial-switch-to-chat');
        window.dispatchEvent(switchToChatEvent);

        // Wait for UI and chat input to be ready, then send the first message
        return new Promise((resolve) => setTimeout(resolve, 500)).then(() => {
          const sendEvent = new CustomEvent('tutorial-send-first-message', {
            detail: { text: 'Add a title card that says Welcome' },
          });
          window.dispatchEvent(sendEvent);
        });
      },
    },
  ],
};
