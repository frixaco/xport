import { ScriptOnce } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getThemeScript(storageKey: string, defaultTheme: Theme) {
  const key = JSON.stringify(storageKey);
  const fallback = JSON.stringify(defaultTheme);

  return `(function(){try{var t=localStorage.getItem(${key});if(t!=='light'&&t!=='dark'&&t!=='system'){t=${fallback}}var d=matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r}catch(e){}})();`;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");

  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    setThemeState(isTheme(stored) ? stored : defaultTheme);
    setMounted(true);
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
  }, [mounted, theme]);

  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);

    return () => media.removeEventListener("change", onChange);
  }, [mounted, theme]);

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      localStorage.setItem(storageKey, nextTheme);
      setThemeState(nextTheme);
    },
    [storageKey],
  );

  const value = useMemo(() => ({ theme, setTheme }), [setTheme, theme]);

  return (
    <ThemeProviderContext value={value}>
      <ScriptOnce>{getThemeScript(storageKey, defaultTheme)}</ScriptOnce>
      {children}
    </ThemeProviderContext>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
