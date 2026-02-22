import { useRef } from 'react';

/** Keeps a ref always in sync with the latest value — useful for stable closures. */
export function useLatestRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
