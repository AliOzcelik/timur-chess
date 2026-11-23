import { create } from 'zustand'
import { api, type Health } from '../lib/api'

interface HealthState {
  health: Health | null
  error: string | null
  refresh: () => Promise<void>
}

export const useHealth = create<HealthState>((set) => ({
  health: null,
  error: null,
  refresh: async () => {
    try {
      set({ health: await api.health(), error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },
}))
