interface HelpRow {
  token: string;
  desc: string;
  example?: string;
}

interface SyntaxHelpTableProps {
  rows: HelpRow[];
  accentColor: string;
  footer: React.ReactNode;
}

export type { HelpRow };

/** Script API rows shared by both TriggerPanel and AliasPanel script help */
export const SCRIPT_API_HELP_ROWS: HelpRow[] = [
  { token: 'await send(text)', desc: 'Send command to MUD (goes through alias expansion)' },
  { token: 'echo(text)', desc: 'Print text locally (not sent to MUD)' },
  { token: 'await delay(ms)', desc: 'Wait N milliseconds' },
  { token: 'setVar(name, val)', desc: 'Set a character variable' },
  { token: "setVar(n, v, 'global')", desc: 'Set a global variable' },
  { token: 'getVar(name)', desc: 'Get variable value (returns string)' },
  { token: 'await spam(n, text)', desc: 'Send command n times (max 1000)' },
];

export const SCRIPT_ACCENT = '#8be9fd';

export function SyntaxHelpTable({ rows, accentColor, footer }: SyntaxHelpTableProps) {
  return (
    <div
      className="mb-2 rounded border overflow-hidden"
      style={{ borderColor: `${accentColor}33`, backgroundColor: `${accentColor}0d` }}
    >
      <table className="w-full text-[10px]">
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.token}
              className="last:border-b-0"
              style={{ borderBottom: `1px solid ${accentColor}1a` }}
            >
              <td
                className="px-2 py-1 font-mono whitespace-nowrap align-top w-[100px]"
                style={{ color: accentColor }}
              >
                {row.token}
              </td>
              <td className="px-2 py-1 text-text-label align-top">
                {row.desc}
                {row.example && <div className="font-mono text-text-dim mt-0.5">{row.example}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className="px-2 py-1.5 text-[10px] text-text-dim"
        style={{ borderTop: `1px solid ${accentColor}1a` }}
      >
        {footer}
      </div>
    </div>
  );
}
