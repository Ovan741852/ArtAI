import { create } from 'zustand'

type HelloState = {
  count: number
  increase: () => void
  reset: () => void
}

export const useHelloStore = create<HelloState>((set) => ({
  count: 0,
  increase: () => set((state) => ({ count: state.count + 1 })),
  reset: () => set({ count: 0 }),
}))
