import { create } from 'zustand';

export interface AttachedTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

interface ChatPanelState {
  isOpen: boolean;
  isFullscreen: boolean;
  activeThreadId: string | null;
  /** Tickets attached to the current chat input (shown as pills). */
  attachedTickets: AttachedTicket[];
  /** Set when a kanban card is being dragged — chat shows drop zone. */
  draggingIssueId: string | null;
  /** Ref to the chat panel DOM element for hit-testing during drag. */
  chatPanelRef: HTMLDivElement | null;
  toggle: () => void;
  open: () => void;
  close: () => void;
  toggleFullscreen: () => void;
  setActiveThread: (id: string | null) => void;
  attachTicket: (ticket: AttachedTicket) => void;
  detachTicket: (ticketId: string) => void;
  clearAttachedTickets: () => void;
  setDraggingIssueId: (id: string | null) => void;
  setChatPanelRef: (el: HTMLDivElement | null) => void;
}

export const useChatStore = create<ChatPanelState>((set) => ({
  isOpen: false,
  isFullscreen: false,
  activeThreadId: null,
  attachedTickets: [],
  draggingIssueId: null,
  chatPanelRef: null,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false, isFullscreen: false }),
  toggleFullscreen: () => set((s) => ({ isFullscreen: !s.isFullscreen })),
  setActiveThread: (id) => set({ activeThreadId: id }),
  attachTicket: (ticket) =>
    set((s) => {
      if (s.attachedTickets.some((t) => t.id === ticket.id)) return s;
      return { attachedTickets: [...s.attachedTickets, ticket] };
    }),
  detachTicket: (ticketId) =>
    set((s) => ({
      attachedTickets: s.attachedTickets.filter((t) => t.id !== ticketId),
    })),
  clearAttachedTickets: () => set({ attachedTickets: [] }),
  setDraggingIssueId: (id) => set({ draggingIssueId: id }),
  setChatPanelRef: (el) => set((s) => (s.chatPanelRef === el ? s : { chatPanelRef: el })),
}));
