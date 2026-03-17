import { create } from 'zustand';

interface ChatPanelState {
  isOpen: boolean;
  isFullscreen: boolean;
  activeThreadId: string | null;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  setActiveThread: (id: string | null) => void;
}

export const useChatStore = create<ChatPanelState>((set) => ({
  isOpen: false,
  isFullscreen: false,
  activeThreadId: null,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, isFullscreen: false }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setActiveThread: (id) => set({ activeThreadId: id }),
}));
