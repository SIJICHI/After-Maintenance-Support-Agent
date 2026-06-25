'use client';

import { useState, createContext, useContext, useLayoutEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  setTheme: () => {},
});

export const useTheme = () => {
  return useContext(ThemeContext);
};

const themeKey = 'app-theme';

const getInitialTheme = (): Theme => {
  // 背景を黒（ダークテーマ）に固定する。
  return 'dark';
};

export const ThemeProvider = ({
  children,
}: {
  children: React.ReactNode | ((props: { theme: Theme }) => React.ReactNode);
}) => {
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(themeKey, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {typeof children === 'function' ? children({ theme }) : children}
    </ThemeContext.Provider>
  );
};
