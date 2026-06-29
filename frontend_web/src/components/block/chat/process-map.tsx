import { useMemo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { isMessageStateEvent } from './types';
import type { ChatStateEvent, ChatMessageEvent } from './types';

interface ProcessStep {
  id: string; // 対応するメッセージのdata-message-id
  label: string;
}

const EMPLOYEE_ID_RE = /^(RSE|FSE)\d+$/i;

function messageText(msg: ChatMessageEvent): string {
  if (msg.content?.content) return msg.content.content;
  return (msg.content?.parts ?? [])
    .map(p => (p.type === 'text' ? p.text : p.type === 'reasoning' ? p.reasoning : ''))
    .join('\n');
}

// 1メッセージをプロセスマップのステップ（ラベル）に分類する。該当なしは null。
function classify(
  msg: ChatMessageEvent,
  isFirstUserPrompt: boolean,
  t: (s: string) => string
): string | null {
  const text = messageText(msg).trim();
  if (!text) return null;

  if (msg.role === 'user') {
    if (EMPLOYEE_ID_RE.test(text)) return null; // 従業員IDはステップにしない
    if (text.startsWith('以下のヒアリング結果です')) return t('Hearing submitted');
    if (text.startsWith('以下の派遣ブリーフィングをFSEにリリース')) return null;
    if (text.startsWith('以下の内容でディスパッチ票を発行')) return null;
    if (text.startsWith('以下のネクストアクションをFSEにリリース')) return null;
    return isFirstUserPrompt ? t('Case input') : t('RSE input');
  }

  if (msg.role === 'assistant') {
    const has = (m: string) => text.includes(m);
    if (has('[[hearing]]')) return t('Hearing with customer');
    if (has('[[triage]]') && has('[[dispatch_briefing]]'))
      return t('Triage update & recipe');
    if (has('[[dispatch_briefing]]')) return t('FSE briefing review/edit');
    if (has('[[triage]]')) return t('Triage draft');
    if (has('[[rse_actions]]')) return t('Next actions draft');
    if (has('[[report]]')) return t('Report draft');
    if (has('[[handoff_draft]]')) return t('Handoff summary');
    if (has('[[steps]]')) return t('Work steps');
    if (text.includes('リリースしました') && text.includes('ブリーフィング'))
      return t('FSE briefing released');
    if (text.includes('リリースしました') && text.includes('ネクストアクション'))
      return t('Next actions released');
  }
  return null;
}

export function ProcessMap({
  events,
  scrollRef,
}: {
  events: ChatStateEvent[];
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();

  const steps = useMemo<ProcessStep[]>(() => {
    const result: ProcessStep[] = [];
    let seenFirstUserPrompt = false;
    for (const e of events) {
      if (!isMessageStateEvent(e)) continue;
      const msg = e.value;
      const isFirstUserPrompt = msg.role === 'user' && !seenFirstUserPrompt;
      const label = classify(msg, isFirstUserPrompt, t);
      if (msg.role === 'user' && label && !EMPLOYEE_ID_RE.test(messageText(msg).trim())) {
        seenFirstUserPrompt = true;
      }
      if (label) {
        result.push({ id: msg.id, label });
      }
    }
    return result;
  }, [events, t]);

  const onJump = (id: string) => {
    const container = scrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (steps.length === 0) {
    return null;
  }

  return (
    <div className="hidden w-56 shrink-0 flex-col overflow-y-auto p-2 md:flex">
      <div className="mb-2 px-1 caption-01 text-muted-foreground">{t('Process map')}</div>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={`${s.id}-${i}`} className="relative">
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={cn(
                `
                  w-full rounded-md border border-border bg-card px-3 py-2 text-left
                  body-secondary transition-colors
                  hover:bg-accent hover:text-accent-foreground
                `
              )}
            >
              <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
