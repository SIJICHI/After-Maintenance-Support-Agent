import { useMemo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { isMessageStateEvent } from './types';
import type { ChatStateEvent, ChatMessageEvent } from './types';

interface ProcessStep {
  id: string; // 対応するメッセージのdata-message-id
  artifact?: string; // メッセージ内の特定成果物(data-artifact)。指定時はその要素へジャンプ
  label: string;
}

const EMPLOYEE_ID_RE = /^(RSE|FSE)\d+$/i;

function messageText(msg: ChatMessageEvent): string {
  if (msg.content?.content) return msg.content.content;
  return (msg.content?.parts ?? [])
    .map(p => (p.type === 'text' ? p.text : p.type === 'reasoning' ? p.reasoning : ''))
    .join('\n');
}

// 1メッセージから複数のプロセスステップを導出する（成果物ごとにカード化）。
function deriveSteps(
  msg: ChatMessageEvent,
  isFirstUserPrompt: boolean,
  t: (s: string) => string
): { label: string; artifact?: string }[] {
  const text = messageText(msg).trim();
  if (!text) return [];

  if (msg.role === 'user') {
    if (EMPLOYEE_ID_RE.test(text)) return [];
    if (text.startsWith('以下のヒアリング結果です')) return [{ label: t('Hearing submitted') }];
    if (text.startsWith('以下の派遣ブリーフィングをFSEにリリース')) return [];
    if (text.startsWith('以下の内容でディスパッチ票を発行')) return [];
    if (text.startsWith('以下のネクストアクションをFSEにリリース')) return [];
    return [{ label: isFirstUserPrompt ? t('Case input') : t('RSE input') }];
  }

  if (msg.role === 'assistant') {
    const has = (m: string) => text.includes(m);
    const steps: { label: string; artifact?: string }[] = [];
    if (has('[[triage]]')) {
      const isUpdate = has('[[dispatch_briefing]]') || has('[[rse_actions]]');
      steps.push({
        label: isUpdate ? t('Triage update & recipe') : t('Triage draft'),
        artifact: 'triage',
      });
    }
    if (has('[[steps]]')) steps.push({ label: t('Work steps'), artifact: 'steps' });
    if (has('[[hearing]]')) steps.push({ label: t('Hearing with customer'), artifact: 'hearing' });
    if (has('[[rse_actions]]'))
      steps.push({ label: t('Next actions draft'), artifact: 'rse-actions' });
    if (has('[[dispatch_briefing]]'))
      steps.push({ label: t('FSE briefing review/edit'), artifact: 'briefing' });
    if (has('[[handoff_draft]]'))
      steps.push({ label: t('Handoff summary'), artifact: 'handoff' });
    if (has('[[report]]')) steps.push({ label: t('Report draft'), artifact: 'report' });
    if (steps.length === 0) {
      if (text.includes('リリースしました') && text.includes('ブリーフィング'))
        steps.push({ label: t('FSE briefing released') });
      else if (text.includes('リリースしました') && text.includes('ネクストアクション'))
        steps.push({ label: t('Next actions released') });
    }
    return steps;
  }
  return [];
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
      const derived = deriveSteps(msg, isFirstUserPrompt, t);
      if (
        msg.role === 'user' &&
        derived.length > 0 &&
        !EMPLOYEE_ID_RE.test(messageText(msg).trim())
      ) {
        seenFirstUserPrompt = true;
      }
      for (const d of derived) {
        result.push({ id: msg.id, artifact: d.artifact, label: d.label });
      }
    }
    return result;
  }, [events, t]);

  const onJump = (step: ProcessStep) => {
    const container = scrollRef.current;
    if (!container) return;
    const selector = step.artifact
      ? `[data-message-id="${step.id}"] [data-artifact="${step.artifact}"]`
      : `[data-message-id="${step.id}"]`;
    const target = container.querySelector<HTMLElement>(selector);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (steps.length === 0) {
    return null;
  }

  return (
    <div className="flex w-56 shrink-0 flex-col overflow-y-auto p-2">
      <div className="mb-2 px-1 caption-01 text-muted-foreground">{t('Process map')}</div>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={`${s.id}-${s.artifact ?? 'msg'}-${i}`}>
            <button
              type="button"
              onClick={() => onJump(s)}
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
