import {createContext, useContext, useEffect, useState, type ReactNode} from "react";

export type ColorTheme = "light" | "dark";

const STORAGE_KEY = "litweave-color-theme";

function systemTheme(): ColorTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initialTheme(): ColorTheme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : systemTheme();
}

export function applyTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

type ThemeContextValue = {
  theme: ColorTheme;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({theme: "light", toggleTheme: () => {}});

export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setTheme] = useState<ColorTheme>(() => initialTheme());

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{theme, toggleTheme: () => setTheme(value => value === "dark" ? "light" : "dark")}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
