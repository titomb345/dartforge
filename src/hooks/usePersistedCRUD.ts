import { useState, useCallback, useRef } from 'react';
import type { DataStore } from '../contexts/DataStoreContext';

interface HasId {
  id: string;
}

export function usePersistedCRUD<T extends HasId>(
  dataStore: DataStore,
  storeKey: string
) {
  const [items, setItems] = useState<T[]>([]);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    const saved = await dataStore.get<T[]>('settings.json', storeKey);
    if (Array.isArray(saved)) {
      setItems(saved);
    }
    loadedRef.current = true;
  }, [dataStore, storeKey]);

  const persist = useCallback(
    (next: T[]) => {
      setItems(next);
      dataStore.set('settings.json', storeKey, next).catch(console.error);
    },
    [dataStore, storeKey]
  );

  const add = useCallback(
    (data: Omit<T, 'id'>) => {
      const item = { ...data, id: crypto.randomUUID() } as T;
      setItems((prev) => {
        const next = [...prev, item];
        dataStore.set('settings.json', storeKey, next).catch(console.error);
        return next;
      });
    },
    [dataStore, storeKey]
  );

  const update = useCallback(
    (id: string, data: Partial<T>) => {
      setItems((prev) => {
        const next = prev.map((item) => (item.id === id ? { ...item, ...data } : item));
        dataStore.set('settings.json', storeKey, next).catch(console.error);
        return next;
      });
    },
    [dataStore, storeKey]
  );

  const remove = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== id);
        dataStore.set('settings.json', storeKey, next).catch(console.error);
        return next;
      });
    },
    [dataStore, storeKey]
  );

  const reorder = useCallback(
    (newItems: T[]) => {
      persist(newItems);
    },
    [persist]
  );

  return { items, loadedRef, load, persist, add, update, remove, reorder };
}
