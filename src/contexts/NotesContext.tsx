import { createContext, useContext, useState, useCallback } from 'react';

interface NotesContextValue {
  pendingAppend: string | null;
  appendToNotes: (text: string) => void;
  consumeAppend: () => string | null;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [pendingAppend, setPendingAppend] = useState<string | null>(null);

  const appendToNotes = useCallback((text: string) => {
    setPendingAppend(text);
  }, []);

  const consumeAppend = useCallback(() => {
    const val = pendingAppend;
    setPendingAppend(null);
    return val;
  }, [pendingAppend]);

  return (
    <NotesContext.Provider value={{ pendingAppend, appendToNotes, consumeAppend }}>
      {children}
    </NotesContext.Provider>
  );
}

export function useNotesContext(): NotesContextValue {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotesContext must be used within a NotesProvider');
  return ctx;
}
