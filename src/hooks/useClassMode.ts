import { useState } from 'react';
import { ClassMode } from '../types';

export function useClassMode() {
  const [classMode, setClassMode] = useState<ClassMode>('fighter');
  return { classMode, setClassMode };
}
