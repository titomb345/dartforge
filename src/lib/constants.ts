import { ClassMode } from '../types';

export const CLASS_MODES: { key: ClassMode; label: string; shortLabel: string }[] = [
  { key: 'mage', label: 'Mage', shortLabel: 'M' },
  { key: 'fighter', label: 'Fighter', shortLabel: 'F' },
  { key: 'multi', label: 'Multi', shortLabel: 'X' },
];

export const CLASS_COLORS: Record<ClassMode, string> = {
  mage: '#a78bfa',
  fighter: '#f59e0b',
  multi: '#10b981',
};
