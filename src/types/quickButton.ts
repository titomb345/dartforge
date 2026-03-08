export type QuickButtonId = string;

export interface QuickButtonToggle {
  variable: string; // variable name to track on/off state
  onLabel: string;
  offLabel: string;
  onColor: string;
  offColor: string;
  onBody: string;
  offBody: string;
  onBodyMode: 'commands' | 'script';
  offBodyMode: 'commands' | 'script';
}

export interface QuickButton {
  id: QuickButtonId;
  label: string;
  color: string;
  body: string;
  bodyMode: 'commands' | 'script';
  enabled: boolean;
  toggle?: QuickButtonToggle;
}
