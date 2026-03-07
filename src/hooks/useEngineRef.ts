import { useRef, useState, useEffect } from 'react';

/**
 * Generic hook for engine-style classes (ActionBlocker, AutoInscriber, AutoCaster, AutoConc)
 * that follow the pattern: ref + state + onChange sync.
 *
 * The engine class must have:
 *   - getState(): S
 *   - onChange: (() => void) | null
 *
 * Returns [ref, state] where ref.current is the engine instance.
 */
interface Engine<S> {
  getState(): S;
  onChange: (() => void) | null;
}

export function useEngineRef<T extends Engine<S>, S = ReturnType<T['getState']>>(
  factory: () => T
): [React.MutableRefObject<T>, S] {
  const ref = useRef<T>(null!);
  if (!ref.current) {
    ref.current = factory();
  }

  const [state, setState] = useState<S>(() => ref.current.getState() as S);

  useEffect(() => {
    const engine = ref.current;
    engine.onChange = () => setState(engine.getState() as S);
    return () => {
      engine.onChange = null;
    };
  }, []);

  return [ref, state];
}
