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
                {row.example && (
                  <div className="font-mono text-text-dim mt-0.5">{row.example}</div>
                )}
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
