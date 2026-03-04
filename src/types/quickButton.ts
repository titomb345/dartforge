export type QuickButtonId = string;

export interface QuickButton {
  id: QuickButtonId;
  label: string;
  color: string;
  body: string;
  bodyMode: 'commands' | 'script';
  enabled: boolean;
}
