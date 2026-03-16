import { create } from 'zustand';

interface ChatPanelState {
  isOpen: boolean;
  activeThreadId: string | null;
  toggle: () => void;
  open: () => void;
  close: () => void;
  setActiveThread: (id: string | null) => void;
}

export const useChatStore = create<ChatPanelState>((set) => ({
  isOpen: false,
  activeThreadId: null,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveThread: (id) => set({ activeThreadId: id }),
}));
