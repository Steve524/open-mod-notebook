import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system' | 'glass' | 'claude' | 'claude-dark'
export type ResolvedTheme = 'light' | 'dark' | 'glass' | 'claude' | 'claude-dark'

const THEME_CLASSES = ['light', 'dark', 'glass', 'claude', 'claude-dark'] as const

// Override skins layer on top of a base scheme, so they apply BOTH classes:
// glass -> dark base, claude -> light base, claude-dark -> dark base. This
// helper is the single source of truth for the resolved -> classes mapping;
// ThemeProvider imports it and theme-script.ts mirrors it in plain JS.
export function themeClassNames(resolved: ResolvedTheme): string[] {
  if (resolved === 'glass') return ['dark', 'glass']
  if (resolved === 'claude') return ['light', 'claude']
  if (resolved === 'claude-dark') return ['dark', 'claude-dark']
  return [resolved]
}

export function applyThemeToDocument(resolved: ResolvedTheme) {
  if (typeof window === 'undefined') return
  const root = window.document.documentElement
  root.classList.remove(...THEME_CLASSES)
  root.classList.add(...themeClassNames(resolved))
  root.setAttribute('data-theme', resolved)
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
  getSystemTheme: () => 'light' | 'dark'
  getResolvedTheme: () => ResolvedTheme
  getEffectiveTheme: () => 'light' | 'dark'
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',

      setTheme: (theme: Theme) => {
        set({ theme })
        applyThemeToDocument(theme === 'system' ? get().getSystemTheme() : theme)
      },

      getSystemTheme: () => {
        if (typeof window !== 'undefined') {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        }
        return 'light'
      },

      getResolvedTheme: () => {
        const { theme } = get()
        return theme === 'system' ? get().getSystemTheme() : theme
      },

      // Collapse skins to their base scheme for consumers that only know
      // light/dark (e.g. the toaster): glass -> dark, claude -> light,
      // claude-dark -> dark.
      getEffectiveTheme: () => {
        const resolved = get().getResolvedTheme()
        return resolved === 'dark' || resolved === 'glass' || resolved === 'claude-dark'
          ? 'dark'
          : 'light'
      },
    }),
    {
      name: 'theme-storage',
      partialize: (state) => ({ theme: state.theme })
    }
  )
)

// Hook for components to use theme
export function useTheme() {
  const { theme, setTheme, getResolvedTheme, getEffectiveTheme } = useThemeStore()

  return {
    theme,
    setTheme,
    resolvedTheme: getResolvedTheme(),
    effectiveTheme: getEffectiveTheme(),
    isDark: getEffectiveTheme() === 'dark',
    isGlass: getResolvedTheme() === 'glass',
    isClaude: getResolvedTheme() === 'claude',
    isClaudeDark: getResolvedTheme() === 'claude-dark',
  }
}
