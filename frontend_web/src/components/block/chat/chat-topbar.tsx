import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { isMessageStateEvent } from './types';
import type { ChatStateEvent, ChatMessageEvent } from './types';

const EMPLOYEE_ID_RE = /\b(RSE|FSE)\d+\b/i;
const DISPATCH_RE = /\bD-\d{8}-\d{4}(?:-\d+)?\b/;

function messageText(msg: ChatMessageEvent): string {
  if (msg.content?.content) return msg.content.content;
  return (msg.content?.parts ?? [])
    .map(p => (p.type === 'text' ? p.text : p.type === 'reasoning' ? p.reasoning : ''))
    .join('\n');
}

// トップ・ステータスストリップ（1b Ops Console）。案件ID・機器名・FSE/RSE表示。
export function ChatTopbar({ events }: { events: ChatStateEvent[] }) {
  const { persona, caseId } = useMemo(() => {
    let persona: 'FSE' | 'RSE' | null = null;
    let caseId: string | null = null;
    for (const e of events) {
      if (!isMessageStateEvent(e)) continue;
      const txt = messageText(e.value);
      if (!persona && e.value.role === 'user') {
        if (/\bFSE\d+/i.test(txt) || txt.includes('[FIELD]')) persona = 'FSE';
        else if (/\bRSE\d+/i.test(txt) || txt.includes('[REMOTE]')) persona = 'RSE';
        else {
          const m = txt.match(EMPLOYEE_ID_RE);
          if (m) persona = m[1].toUpperCase() === 'FSE' ? 'FSE' : 'RSE';
        }
      }
      const d = txt.match(DISPATCH_RE);
      if (d) caseId = d[0];
    }
    return { persona, caseId };
  }, [events]);

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-[var(--midnight-gray-100)] px-4">
      <div className="flex items-center gap-[14px]">
        <SidebarTrigger className="-ml-1 text-foreground" title="サイドバーの表示/非表示" />
        <span className="flex items-center gap-2 text-[12.5px] font-bold tracking-[0.02em] text-foreground">
          <span className="flex size-[18px] items-center justify-center rounded bg-[var(--green-50)] text-[11px] text-black">
            A
          </span>
          SUPPORT AGENT
        </span>
        <span className="h-4 w-px bg-border" />
        <span className="font-mono text-[11px] text-muted-foreground">{caseId ?? '—'}</span>
        <span className="text-[11.5px] text-foreground">EVS-X1000 内視鏡システム</span>
      </div>
      <div className="flex items-center gap-[5px] rounded-md border border-border bg-card p-[3px]">
        <span
          className={cn(
            'rounded px-3 py-1 font-mono text-[11px] font-bold',
            persona === 'FSE'
              ? 'bg-[var(--green-50)] text-black'
              : 'bg-transparent text-muted-foreground'
          )}
        >
          FSE
        </span>
        <span
          className={cn(
            'rounded px-3 py-1 font-mono text-[11px] font-bold',
            persona === 'RSE'
              ? 'bg-[var(--azure-50)] text-black'
              : 'bg-transparent text-muted-foreground'
          )}
        >
          RSE
        </span>
      </div>
    </div>
  );
}
