'use client'

import { useEffect } from 'react'
import { useThemeStore, applyThemeToDocument } from '@/lib/stores/theme-store'

interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme, getSystemTheme, getResolvedTheme } = useThemeStore()

  useEffect(() => {
    // Initialize theme on mount (glass maps to `dark glass` via the shared helper)
    applyThemeToDocument(getResolvedTheme())

    // Listen for system theme changes when using system preference
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

      const handleChange = () => {
        applyThemeToDocument(getSystemTheme())
      }

      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme, getSystemTheme, getResolvedTheme])

  return <>{children}</>
}
