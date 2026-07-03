import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark'

const THEME_STORAGE_KEY = 'wif_theme'
const DARK_CLASS = 'dark-mode'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

function resolveInitialTheme(): ThemeMode {
  const stored = readStoredTheme()
  if (stored) return stored

  if (typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches) {
    return 'dark'
  }

  return 'light'
}

export function applyThemeClass(mode: ThemeMode) {
  if (typeof document === 'undefined') return

  document.documentElement.classList.toggle(DARK_CLASS, mode === 'dark')
}

function persistTheme(mode: ThemeMode) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Storage can be blocked in private or restricted contexts.
  }
}

export const themeMode = ref<ThemeMode>(resolveInitialTheme())

watch(themeMode, (next) => {
  applyThemeClass(next)
  persistTheme(next)
})

let systemPreferenceBound = false

function bindSystemThemePreference() {
  if (typeof window === 'undefined' || systemPreferenceBound) return

  const query = window.matchMedia?.(DARK_QUERY)
  if (!query) return

  systemPreferenceBound = true

  const onChange = (event: MediaQueryListEvent) => {
    const next: ThemeMode = event.matches ? 'dark' : 'light'
    themeMode.value = next
    applyThemeClass(next)
    persistTheme(next)
  }

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange)
  } else {
    query.addListener(onChange)
  }
}

export function toggleTheme() {
  const next: ThemeMode = themeMode.value === 'dark' ? 'light' : 'dark'
  themeMode.value = next
  applyThemeClass(next)
  persistTheme(next)
}

export function hydrateThemeOnBoot() {
  applyThemeClass(themeMode.value)
  bindSystemThemePreference()
}
