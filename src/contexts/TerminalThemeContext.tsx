import { createContext, useContext } from 'react';
import { DEFAULT_THEME, type TerminalTheme } from '../lib/defaultTheme';

const TerminalThemeContext = createContext<TerminalTheme>(DEFAULT_THEME);

export const TerminalThemeProvider = TerminalThemeContext.Provider;

export function useTerminalTheme(): TerminalTheme {
  return useContext(TerminalThemeContext);
}
