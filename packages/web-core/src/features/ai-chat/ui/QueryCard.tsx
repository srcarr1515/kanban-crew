import { useState } from 'react';
import { PlayIcon, SpinnerIcon, TableIcon, WarningCircleIcon } from '@phosphor-icons/react';
import type { QueryBlock, QueryResult } from '@/shared/lib/local/chatApi';
import { executeQuery } from '@/shared/lib/local/chatApi';

interface QueryCardProps {
  query: QueryBlock;
  crewMemberId?: string;
}

export function QueryCard({ query, crewMemberId }: QueryCardProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setStatus('running');
    setError(null);
    try {
      const data = await executeQuery(query.sql, crewMemberId);
      setResult(data);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed');
      setStatus('error');
    }
  };

  return (
    <div className="my-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 mb-2">
        <TableIcon className="size-3.5" weight="bold" />
        Database Query
      </div>

      {/* SQL preview */}
      <pre className="text-xs bg-black/20 rounded-md px-2.5 py-2 mb-3 overflow-x-auto text-high font-mono whitespace-pre-wrap break-words">
        {query.sql}
      </pre>

      {status === 'idle' && (
        <button
          type="button"
          onClick={handleRun}
          className="flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500/90 transition-colors"
        >
          <PlayIcon className="size-3.5" weight="fill" />
          Run Query
        </button>
      )}

      {status === 'running' && (
        <div className="flex items-center gap-1.5 text-xs text-blue-400">
          <SpinnerIcon className="size-3.5 animate-spin" />
          Running query…
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <WarningCircleIcon className="size-3.5" weight="fill" />
            {error}
          </div>
          <button
            type="button"
            onClick={handleRun}
            className="flex items-center gap-1.5 rounded-md border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
          >
            <PlayIcon className="size-3.5" weight="fill" />
            Retry
          </button>
        </div>
      )}

      {status === 'done' && result && (
        <div className="space-y-2">
          <div className="text-xs text-low">
            {result.row_count} row{result.row_count !== 1 ? 's' : ''} returned
          </div>
          {result.columns.length > 0 && result.rows.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-panel">
                    {result.columns.map((col) => (
                      <th
                        key={col}
                        className="px-2.5 py-1.5 text-left font-semibold text-normal border-b border-border whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr
                      key={i}
                      className={i % 2 === 0 ? 'bg-primary' : 'bg-secondary/50'}
                    >
                      {row.map((val, j) => (
                        <td
                          key={j}
                          className="px-2.5 py-1.5 text-high border-b border-border/50 whitespace-nowrap max-w-[300px] truncate"
                          title={String(val ?? '')}
                        >
                          {val === null ? (
                            <span className="text-low italic">NULL</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-low italic">No rows returned</div>
          )}
          <button
            type="button"
            onClick={handleRun}
            className="flex items-center gap-1.5 rounded-md border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-400 hover:bg-blue-500/10 transition-colors"
          >
            <PlayIcon className="size-3.5" weight="fill" />
            Re-run
          </button>
        </div>
      )}
    </div>
  );
}
