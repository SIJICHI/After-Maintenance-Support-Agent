import {
  memo,
  useMemo,
  useState,
  useRef,
  Component,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import {
  User,
  Bot,
  Cog,
  Hammer,
  Wrench,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Brain,
  FileText,
  Download,
} from 'lucide-react';
import { CodeBlock } from '@/components/ui/code-block';
import { cn } from '@/lib/utils';
import type { ContentPart, ToolInvocationUIPart, ChatMessageEvent } from './types';
import { useChatContext } from '@/components/block/chat/hooks/use-chat-context';
import { Badge } from '@/components/ui/badge';
import { Markdown } from '@/components/block/markdown';
import { useTranslation } from '@/lib/i18n';

interface ChatMessageErrorBoundaryProps {
  children: ReactNode;
  message: ChatMessageEvent;
  title: string;
}

interface ChatMessageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ChatMessageErrorBoundary extends Component<
  ChatMessageErrorBoundaryProps,
  ChatMessageErrorBoundaryState
> {
  constructor(props: ChatMessageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ChatMessageErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ChatMessage render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={'flex gap-3 rounded-lg bg-card p-4'}>
          <div className="shrink-0">
            <div className="flex size-8 items-center justify-center rounded-full bg-destructive/20 text-destructive">
              <AlertTriangle className="size-4" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="mn-label text-destructive">{this.props.title}</span>
            </div>
            <CodeBlock code={JSON.stringify(this.props.message, null, 2)} />
            {this.state.error && (
              <div className="my-2 caption-01">
                <div>{this.state.error.message}</div>
                <div>{this.state.error.stack}</div>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function UniversalContentPart({ part }: { part: ContentPart }) {
  if (part.type === 'text') {
    return <TextContentPart content={part.text} />;
  }
  if (part.type === 'reasoning') {
    return <TextContentPart content={part.reasoning} />;
  }
  if (part.type === 'tool-invocation') {
    return <ToolInvocationPart part={part} />;
  }
  return <CodeBlock code={JSON.stringify(part, null, '  ')} />;
}

const CHOICES_REGEX = /\[\[choices\]\]\s*([\s\S]*?)\s*\[\[\/choices\]\]/;
const STEPS_REGEX = /\[\[steps\]\]\s*([\s\S]*?)\s*\[\[\/steps\]\]/;
const COMPLETE_REGEX = /\[\[complete_action\]\]\s*([\s\S]*?)\s*\[\[\/complete_action\]\]/;
const REPORT_REGEX = /\[\[report\]\]\s*([\s\S]*?)\s*\[\[\/report\]\]/;
const HANDOFF_REGEX = /\[\[handoff_draft\]\]\s*([\s\S]*?)\s*\[\[\/handoff_draft\]\]/;
const RSE_ACTIONS_REGEX = /\[\[rse_actions\]\]\s*([\s\S]*?)\s*\[\[\/rse_actions\]\]/;
const HEARING_REGEX = /\[\[hearing\]\]\s*([\s\S]*?)\s*\[\[\/hearing\]\]/;
const BRIEFING_REGEX = /\[\[dispatch_briefing\]\]\s*([\s\S]*?)\s*\[\[\/dispatch_briefing\]\]/;

interface StepRow {
  item: string;
  details: string[];
  notes: string;
}

// [[steps]] ブロックを「作業項目 | 詳細1;詳細2 | 注意事項」のパイプ区切り行として解析する。
function parseSteps(content: string): { rest: string; rows: StepRow[] } {
  const match = content.match(STEPS_REGEX);
  if (!match) {
    return { rest: content, rows: [] };
  }
  const rows: StepRow[] = match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const cols = line.split('|').map(c => c.trim());
      const item = (cols[0] ?? '').replace(/^[\s\-*0-9.)、）]+/, '').trim();
      const details = (cols[1] ?? '')
        .split(/[;；]/)
        .map(d => d.trim())
        .filter(Boolean);
      const notes = cols[2] ?? '';
      return { item, details, notes };
    })
    .filter(row => row.item);
  const rest = content.replace(STEPS_REGEX, '').trimEnd();
  return { rest, rows };
}

// パイプ区切り行（作業項目 | 詳細1;詳細2 | 注意事項）を StepRow[] に解析する。
function parsePipeRows(body: string): StepRow[] {
  return body
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const cols = line.split('|').map(c => c.trim());
      const item = (cols[0] ?? '').replace(/^[\s\-*0-9.)、）]+/, '').trim();
      const details = (cols[1] ?? '')
        .split(/[;；]/)
        .map(d => d.trim())
        .filter(Boolean);
      const notes = cols[2] ?? '';
      return { item, details, notes };
    })
    .filter(row => row.item);
}

// [[rse_actions]] を編集可能アクション表の行として解析する。
function parseRseActions(content: string): { rest: string; rows: StepRow[] | null } {
  const match = content.match(RSE_ACTIONS_REGEX);
  if (!match) {
    return { rest: content, rows: null };
  }
  return { rest: content.replace(RSE_ACTIONS_REGEX, '').trimEnd(), rows: parsePipeRows(match[1]) };
}

// [[hearing]] を顧客ヒアリングのチェック表として解析する。
function parseHearing(content: string): { rest: string; rows: StepRow[] | null } {
  const match = content.match(HEARING_REGEX);
  if (!match) {
    return { rest: content, rows: null };
  }
  return { rest: content.replace(HEARING_REGEX, '').trimEnd(), rows: parsePipeRows(match[1]) };
}

interface DispatchBriefing {
  dispatch_id: string;
  symptom: string;
  diagnosis: string;
  initial_response: string;
  parts_to_bring: string;
  focus_points: string;
  notes: string;
}

const BRIEFING_KEYS: (keyof DispatchBriefing)[] = [
  'dispatch_id',
  'symptom',
  'diagnosis',
  'initial_response',
  'parts_to_bring',
  'focus_points',
  'notes',
];

// [[dispatch_briefing]] を「キー: 値」行として解析する。
function parseBriefing(content: string): { rest: string; briefing: DispatchBriefing | null } {
  const match = content.match(BRIEFING_REGEX);
  if (!match) {
    return { rest: content, briefing: null };
  }
  const fields: Record<string, string> = {};
  match[1].split('\n').forEach(line => {
    const m = line.match(
      /^\s*(dispatch_id|symptom|diagnosis|initial_response|parts_to_bring|focus_points|notes)\s*[:：]\s*(.*)$/
    );
    if (m) {
      fields[m[1]] = m[2].trim();
    }
  });
  const briefing = BRIEFING_KEYS.reduce((acc, k) => {
    acc[k] = fields[k] ?? '';
    return acc;
  }, {} as DispatchBriefing);
  return { rest: content.replace(BRIEFING_REGEX, '').trimEnd(), briefing };
}

// [[choices]] ブロックを解析する。先頭が「?」の行は質問文、それ以外は選択肢。
function parseChoices(content: string): { rest: string; question: string; choices: string[] } {
  const match = content.match(CHOICES_REGEX);
  if (!match) {
    return { rest: content, question: '', choices: [] };
  }
  const questionLines: string[] = [];
  const choices: string[] = [];
  match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      if (/^[?？]/.test(line)) {
        questionLines.push(line.replace(/^[?？]\s*/, '').trim());
      } else {
        choices.push(line.replace(/^[\s\-*0-9.)、）]+/, '').trim());
      }
    });
  const rest = content.replace(CHOICES_REGEX, '').trimEnd();
  return { rest, question: questionLines.join(' '), choices: choices.filter(Boolean) };
}

// [[complete_action]] は「全チェック完了時に表の下へ出す質問＋選択肢」。形式は choices と同じ。
function parseCompleteAction(content: string): {
  rest: string;
  question: string;
  choices: string[];
} {
  const match = content.match(COMPLETE_REGEX);
  if (!match) {
    return { rest: content, question: '', choices: [] };
  }
  const questionLines: string[] = [];
  const choices: string[] = [];
  match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      if (/^[?？]/.test(line)) {
        questionLines.push(line.replace(/^[?？]\s*/, '').trim());
      } else {
        choices.push(line.replace(/^[\s\-*0-9.)、）]+/, '').trim());
      }
    });
  const rest = content.replace(COMPLETE_REGEX, '').trimEnd();
  return { rest, question: questionLines.join(' '), choices: choices.filter(Boolean) };
}

interface HandoffDraft {
  parent_dispatch_id: string;
  summary: string;
  error_codes: string;
  recommended_parts: string;
  open_questions: string;
}

// [[handoff_draft]] を「キー: 値」行として解析する。
function parseHandoff(content: string): { rest: string; handoff: HandoffDraft | null } {
  const match = content.match(HANDOFF_REGEX);
  if (!match) {
    return { rest: content, handoff: null };
  }
  const fields: Record<string, string> = {};
  match[1].split('\n').forEach(line => {
    const m = line.match(
      /^\s*(parent_dispatch_id|summary|error_codes|recommended_parts|open_questions)\s*[:：]\s*(.*)$/
    );
    if (m) {
      fields[m[1]] = m[2].trim();
    }
  });
  const handoff: HandoffDraft = {
    parent_dispatch_id: fields.parent_dispatch_id ?? '',
    summary: fields.summary ?? '',
    error_codes: fields.error_codes ?? '',
    recommended_parts: fields.recommended_parts ?? '',
    open_questions: fields.open_questions ?? '',
  };
  const rest = content.replace(HANDOFF_REGEX, '').trimEnd();
  return { rest, handoff };
}

function parseContent(content: string): {
  text: string;
  steps: StepRow[];
  question: string;
  choices: string[];
  completeQuestion: string;
  completeChoices: string[];
  report: string;
  reportDispatchId: string;
  handoff: HandoffDraft | null;
  rseActions: StepRow[] | null;
  hearing: StepRow[] | null;
  briefing: DispatchBriefing | null;
} {
  const stepsResult = parseSteps(content);
  const rseActionsResult = parseRseActions(stepsResult.rest);
  const hearingResult = parseHearing(rseActionsResult.rest);
  const briefingResult = parseBriefing(hearingResult.rest);
  const handoffResult = parseHandoff(briefingResult.rest);
  const completeResult = parseCompleteAction(handoffResult.rest);
  const reportMatch = completeResult.rest.match(REPORT_REGEX);
  let report = reportMatch ? reportMatch[1].trim() : '';
  // 報告書先頭のメタ行 "dispatch_id: D-..." を抽出し、表示からは除く（ファイル名に使う）。
  let reportDispatchId = '';
  if (report) {
    const metaMatch = report.match(/^\s*dispatch_id\s*[:：]\s*(D-[\w-]+)\s*\n?/i);
    if (metaMatch) {
      reportDispatchId = metaMatch[1];
      report = report.replace(metaMatch[0], '').trim();
    }
  }
  const afterReport = reportMatch
    ? completeResult.rest.replace(REPORT_REGEX, '').trimEnd()
    : completeResult.rest;
  const choicesResult = parseChoices(afterReport);
  return {
    text: choicesResult.rest,
    steps: stepsResult.rows,
    question: choicesResult.question,
    choices: choicesResult.choices,
    completeQuestion: completeResult.question,
    completeChoices: completeResult.choices,
    report,
    reportDispatchId,
    handoff: handoffResult.handoff,
    rseActions: rseActionsResult.rows,
    hearing: hearingResult.rows,
    briefing: briefingResult.briefing,
  };
}

function downloadAsWord(filename: string, htmlBody: string): void {
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8">` +
    `<style>body{font-family:'Yu Gothic','Meiryo',sans-serif;font-size:11pt;line-height:1.6;}` +
    `table{border-collapse:collapse;}td,th{border:1px solid #888;padding:4px 8px;}</style>` +
    `</head><body>${htmlBody}</body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 内容から安定したキーを作り、チェック状態を localStorage に保存する（リロードしても維持）。
function hashKey(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return `fse-steps-${(hash >>> 0).toString(36)}`;
}

// 注意事項セル。各項目はセミコロン区切り。先頭が「!」の項目は安全重要事項として
// 警告アイコン＋赤系で強調する。
function NotesCell({ notes }: { notes: string }) {
  const items = notes
    .split(/[;；]/)
    .map(n => n.trim())
    .filter(Boolean);

  if (items.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <ul className="space-y-1">
      {items.map((raw, i) => {
        const isSafety = /^[!！]/.test(raw);
        const text = raw.replace(/^[!！]\s*/, '');
        if (isSafety) {
          return (
            <li
              key={i}
              className={cn(
                `
                  flex items-start gap-1.5 rounded border border-yellow-400/50
                  bg-yellow-500/15 px-2 py-1 text-yellow-300
                `
              )}
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="font-medium">{text}</span>
            </li>
          );
        }
        return (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground" />
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StepChecklist({
  steps,
  completeQuestion,
  completeChoices,
  title,
  itemHeader,
  detailsHeader,
  notesHeader,
}: {
  steps: StepRow[];
  completeQuestion?: string;
  completeChoices?: string[];
  title?: string;
  itemHeader?: string;
  detailsHeader?: string;
  notesHeader?: string;
}) {
  const { t } = useTranslation();
  const storageKey = useMemo(() => hashKey(steps.map(s => s.item).join('|')), [steps]);
  const [checked, setChecked] = useState<boolean[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as boolean[];
          if (Array.isArray(parsed) && parsed.length === steps.length) {
            return parsed;
          }
        }
      } catch {
        // ignore
      }
    }
    return steps.map(() => false);
  });

  const toggle = (i: number) => {
    setChecked(prev => {
      const next = prev.map((v, idx) => (idx === i ? !v : v));
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const doneCount = checked.filter(Boolean).length;
  const allDone = steps.length > 0 && doneCount === steps.length;

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2
          caption-01 text-muted-foreground
        `}
      >
        <CheckCircle2 className="size-4" />
        {title ?? t('Work checklist')} ({doneCount}/{steps.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse body-secondary text-foreground!">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left">
              <th className="w-10 px-2 py-2 text-center">✓</th>
              <th className="px-3 py-2">{itemHeader ?? t('Step')}</th>
              <th className="px-3 py-2">{detailsHeader ?? t('Details')}</th>
              <th className="px-3 py-2">{notesHeader ?? t('Notes')}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0 align-top">
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={checked[i] ?? false}
                    onChange={() => toggle(i)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                </td>
                <td className={cn('px-3 py-2 font-medium', checked[i] && 'line-through')}>
                  {row.item}
                </td>
                <td className="px-3 py-2">
                  {row.details.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {row.details.map((d, j) => (
                        <li key={j}>{d}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <NotesCell notes={row.notes} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {allDone && completeChoices && completeChoices.length > 0 && (
        <div className="border-t border-border bg-muted/20 p-3">
          {completeQuestion && <div className="mb-2 body font-medium">{completeQuestion}</div>}
          <QuickReplies choices={completeChoices} />
        </div>
      )}
    </div>
  );
}

function QuickReplies({ choices }: { choices: string[] }) {
  const { sendMessage, setUserInput, isAgentRunning } = useChatContext();
  const { t } = useTranslation();

  // 「その他」: 選択肢にない内容をFSEが自由記述できるよう、入力欄にフォーカスさせる。
  const onOther = () => {
    setUserInput('');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>('[data-chat-input]');
      el?.focus();
    });
  };

  // 「その他」チップはUIが常に付けるため、エージェントが出した同義の選択肢は除去して重複を防ぐ。
  const visibleChoices = choices.filter(c => !/^(その他|other)/i.test(c.trim()));

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {visibleChoices.map((choice, i) => (
        <button
          key={i}
          type="button"
          disabled={isAgentRunning}
          onClick={() => sendMessage(choice)}
          className={cn(
            `
              rounded-full border border-border bg-card px-4 py-2 body-secondary
              transition-colors
              hover:bg-accent hover:text-accent-foreground
            `,
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          {choice}
        </button>
      ))}
      <button
        type="button"
        disabled={isAgentRunning}
        onClick={onOther}
        className={cn(
          `
            rounded-full border border-dashed border-muted-foreground/60 px-4 py-2
            body-secondary text-muted-foreground transition-colors
            hover:bg-accent hover:text-accent-foreground
          `,
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {t('その他（自由記述）')}
      </button>
    </div>
  );
}

// FSE派遣ブリーフィングの編集カード。RSEが内容を編集し、担当営業所のFSEへリリースできる。
function DispatchBriefingCard({ briefing }: { briefing: DispatchBriefing }) {
  const { t } = useTranslation();
  const { sendMessage, isAgentRunning } = useChatContext();
  const [fields, setFields] = useState<DispatchBriefing>(briefing);
  const [released, setReleased] = useState(false);

  const update = (key: keyof DispatchBriefing, value: string) =>
    setFields(prev => ({ ...prev, [key]: value }));

  const onRelease = () => {
    setReleased(true);
    const msg =
      '以下の派遣ブリーフィングをFSEにリリースしてください。\n' +
      BRIEFING_KEYS.map(k => `${k}: ${fields[k]}`).join('\n');
    sendMessage(msg);
  };

  const rows: { key: keyof DispatchBriefing; label: string; multiline: boolean }[] = [
    { key: 'dispatch_id', label: t('Dispatch No.'), multiline: false },
    { key: 'symptom', label: t('Reported symptom'), multiline: true },
    { key: 'diagnosis', label: t('Estimated cause / findings'), multiline: true },
    { key: 'initial_response', label: t('Initial response done'), multiline: true },
    { key: 'parts_to_bring', label: t('Parts to bring (; separated)'), multiline: true },
    { key: 'focus_points', label: t('Focus points for FSE (; separated)'), multiline: true },
    { key: 'notes', label: t('Notes'), multiline: true },
  ];

  const inputCls =
    'w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 body-secondary text-foreground! focus:border-primary focus:outline-none disabled:opacity-60';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 caption-01
          text-muted-foreground
        `}
      >
        <FileText className="size-4" />
        {t('FSE dispatch briefing (review & edit before releasing)')}
      </div>
      <div className="flex flex-col gap-3 p-3">
        {rows.map(({ key, label, multiline }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="caption-01 text-muted-foreground">{label}</span>
            {multiline ? (
              <textarea
                value={fields[key]}
                disabled={released || isAgentRunning}
                rows={2}
                onChange={e => update(key, e.target.value)}
                className={inputCls}
              />
            ) : (
              <input
                type="text"
                value={fields[key]}
                disabled={released || isAgentRunning}
                onChange={e => update(key, e.target.value)}
                className={inputCls}
              />
            )}
          </label>
        ))}
        {!released ? (
          <div>
            <button
              type="button"
              disabled={isAgentRunning}
              onClick={onRelease}
              className={cn(
                `
                  rounded-md border border-border bg-primary px-4 py-2 body-secondary
                  text-primary-foreground
                  hover:opacity-90
                `,
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {t('Release dispatch briefing to FSE')}
            </button>
          </div>
        ) : (
          <div className="caption-01 text-muted-foreground">{t('Released to FSE.')}</div>
        )}
      </div>
    </div>
  );
}

// RSE向けの編集可能ネクストアクション表。RSEがFSEと相談しながら編集・追記し、
// 確定後に「FSEにリリース」（共有）できる。チェックボックス付き。
function EditableActionTable({ rows: initialRows }: { rows: StepRow[] }) {
  const { t } = useTranslation();
  const { sendMessage, isAgentRunning } = useChatContext();
  const [rows, setRows] = useState<StepRow[]>(
    initialRows.length ? initialRows : [{ item: '', details: [], notes: '' }]
  );
  const [released, setReleased] = useState(false);

  const setItem = (i: number, v: string) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, item: v } : r)));
  const setDetails = (i: number, v: string) =>
    setRows(prev =>
      prev.map((r, idx) =>
        idx === i ? { ...r, details: v.split('\n').map(s => s.trim()).filter(Boolean) } : r
      )
    );
  const setNotes = (i: number, v: string) =>
    setRows(prev =>
      prev.map((r, idx) =>
        idx === i ? { ...r, notes: v.split('\n').map(s => s.trim()).filter(Boolean).join(';') } : r
      )
    );
  const addRow = () => {
    setRows(prev => [...prev, { item: '', details: [], notes: '' }]);
  };
  const removeRow = (i: number) => {
    setRows(prev => prev.filter((_, idx) => idx !== i));
  };

  const onRelease = () => {
    const valid = rows.filter(r => r.item.trim());
    if (valid.length === 0) return;
    setReleased(true);
    const pipe = valid
      .map(r => `${r.item} | ${r.details.join(';')} | ${r.notes}`)
      .join('\n');
    sendMessage(`以下のネクストアクションをFSEにリリースしてください。\n${pipe}`);
  };

  const inputCls =
    'w-full resize-y rounded border border-border bg-background px-2 py-1 body-secondary text-foreground! focus:border-primary focus:outline-none disabled:opacity-60';

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 caption-01
          text-muted-foreground
        `}
      >
        <CheckCircle2 className="size-4" />
        {t('Next actions for FSE (edit & release)')}
      </div>
      <div className="flex flex-col gap-3 p-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-md border border-border p-2">
            <div className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <input
                  type="text"
                  value={row.item}
                  disabled={released || isAgentRunning}
                  placeholder={t('Step')}
                  onChange={e => setItem(i, e.target.value)}
                  className={cn(inputCls, 'font-medium')}
                />
                <textarea
                  value={row.details.join('\n')}
                  disabled={released || isAgentRunning}
                  placeholder={t('Details (one per line)')}
                  rows={Math.max(2, row.details.length)}
                  onChange={e => setDetails(i, e.target.value)}
                  className={inputCls}
                />
                <textarea
                  value={row.notes.split(/[;；]/).filter(Boolean).join('\n')}
                  disabled={released || isAgentRunning}
                  placeholder={t('Notes (one per line, prefix ! for safety)')}
                  rows={1}
                  onChange={e => setNotes(i, e.target.value)}
                  className={inputCls}
                />
              </div>
              {!released && (
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  title={t('Remove row')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        {!released && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              disabled={isAgentRunning}
              className={`
                rounded-md border border-dashed border-muted-foreground/60 px-3 py-1.5
                body-secondary text-muted-foreground
                hover:bg-accent hover:text-accent-foreground
              `}
            >
              {t('+ Add row')}
            </button>
            <button
              type="button"
              onClick={onRelease}
              disabled={isAgentRunning}
              className={cn(
                `
                  rounded-md border border-border bg-primary px-4 py-1.5 body-secondary
                  text-primary-foreground
                  hover:opacity-90
                `,
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {t('Release to FSE')}
            </button>
          </div>
        )}
        {released && (
          <div className="caption-01 text-muted-foreground">{t('Released to FSE.')}</div>
        )}
      </div>
    </div>
  );
}

// HQ引き継ぎ要約のドラフトカード。FSEが各欄を編集して発行を確定できる（human-in-the-loop）。
function HandoffDraftCard({ handoff }: { handoff: HandoffDraft }) {
  const { t } = useTranslation();
  const { sendMessage, isAgentRunning } = useChatContext();
  const [fields, setFields] = useState<HandoffDraft>(handoff);
  const [issued, setIssued] = useState(false);

  const update = (key: keyof HandoffDraft, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const onIssue = () => {
    setIssued(true);
    const msg =
      '以下の内容でディスパッチ票を発行してください。\n' +
      `parent_dispatch_id: ${fields.parent_dispatch_id}\n` +
      `summary: ${fields.summary}\n` +
      `error_codes: ${fields.error_codes}\n` +
      `recommended_parts: ${fields.recommended_parts}\n` +
      `open_questions: ${fields.open_questions}`;
    sendMessage(msg);
  };

  const rows: { key: keyof HandoffDraft; label: string }[] = [
    { key: 'parent_dispatch_id', label: t('Case dispatch No. (parent)') },
    { key: 'summary', label: t('Summary') },
    { key: 'error_codes', label: t('Error codes') },
    { key: 'recommended_parts', label: t('Recommended parts') },
    { key: 'open_questions', label: t('Open questions') },
  ];

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 caption-01
          text-muted-foreground
        `}
      >
        <FileText className="size-4" />
        {t('HQ handoff summary (review & edit before issuing)')}
      </div>
      <div className="flex flex-col gap-3 p-3">
        {rows.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="caption-01 text-muted-foreground">{label}</span>
            <textarea
              value={fields[key]}
              disabled={issued || isAgentRunning}
              onChange={e => update(key, e.target.value)}
              rows={key === 'summary' || key === 'open_questions' ? 3 : 1}
              className={`
                w-full resize-y rounded-md border border-border bg-background px-2 py-1.5
                body-secondary text-foreground!
                focus:border-primary focus:outline-none
                disabled:opacity-60
              `}
            />
          </label>
        ))}
        <div>
          <button
            type="button"
            disabled={issued || isAgentRunning}
            onClick={onIssue}
            className={cn(
              `
                rounded-md border border-border bg-primary px-4 py-2 body-secondary
                text-primary-foreground transition-colors
                hover:opacity-90
              `,
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {issued ? t('Issuing…') : t('Issue dispatch ticket with this content')}
          </button>
        </div>
      </div>
    </div>
  );
}

// 報告書ドラフトのカード表示。Markdownで描画し、その描画HTMLをWord(.doc)として出力する。
function ReportCard({ report, dispatchId }: { report: string; dispatchId?: string }) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);

  const onDownload = () => {
    const html = bodyRef.current?.innerHTML ?? '';
    const today = new Date().toISOString().slice(0, 10);
    const filename = dispatchId
      ? `service_report_${dispatchId}_${today}.doc`
      : `service_report_${today}.doc`;
    downloadAsWord(filename, html);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center justify-between gap-2 border-b border-border bg-muted/30
          px-3 py-2 caption-01 text-muted-foreground
        `}
      >
        <span className="flex items-center gap-2">
          <FileText className="size-4" />
          {t('Service report draft')}
        </span>
        <button
          type="button"
          onClick={onDownload}
          className={`
            flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5
            body-secondary transition-colors
            hover:bg-accent hover:text-accent-foreground
          `}
        >
          <Download className="size-3.5" />
          {t('Download as Word')}
        </button>
      </div>
      <div ref={bodyRef} className="px-4 py-3">
        <Markdown>{report}</Markdown>
      </div>
    </div>
  );
}

export function TextContentPart({ content }: { content: string }) {
  const {
    text,
    steps,
    question,
    choices,
    completeQuestion,
    completeChoices,
    report,
    reportDispatchId,
    handoff,
    rseActions,
    hearing,
    briefing,
  } = useMemo(() => parseContent(content ? content : ''), [content]);
  return (
    <>
      <Markdown>{text}</Markdown>
      {steps.length > 0 && (
        <StepChecklist
          steps={steps}
          completeQuestion={completeQuestion}
          completeChoices={completeChoices}
        />
      )}
      {hearing && hearing.length > 0 && (
        <StepChecklist
          steps={hearing}
          title={t('Hearing checklist (confirm with customer)')}
          itemHeader={t('Item to confirm')}
          detailsHeader={t('Points')}
          notesHeader={t('Memo')}
        />
      )}
      {rseActions && <EditableActionTable rows={rseActions} />}
      {briefing && <DispatchBriefingCard briefing={briefing} />}
      {handoff && <HandoffDraftCard handoff={handoff} />}
      {report && <ReportCard report={report} dispatchId={reportDispatchId} />}
      {question && <div className="mt-3 body font-medium">{question}</div>}
      {choices.length > 0 && <QuickReplies choices={choices} />}
    </>
  );
}

export function ToolInvocationPart({ part }: { part: ToolInvocationUIPart }) {
  const { t } = useTranslation();
  const { toolInvocation } = part;
  const { toolName } = toolInvocation;
  const ctx = useChatContext();
  const tool = ctx.getTool(toolName);

  const hasResult = !!toolInvocation.result;
  const result = useMemo(() => {
    if (!hasResult) {
      return '';
    }

    try {
      if (toolInvocation.result) {
        return JSON.stringify(JSON.parse(toolInvocation.result), null, '  ');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.debug('Tool result is not a JSON', toolInvocation.result, e);
    }
    return toolInvocation.result || '';
  }, [toolInvocation.result, hasResult]);

  if (tool?.render) {
    return tool.render({ status: 'complete', args: toolInvocation.args });
  }
  if (tool?.renderAndWait) {
    return tool.renderAndWait({
      status: 'complete',
      args: toolInvocation.args,
      callback: event => {
        // eslint-disable-next-line no-console
        console.debug('Tool render event', event);
      },
    });
  }

  return <ToolInvocationCard toolName={toolInvocation.toolName} args={toolInvocation.args} result={result} hasResult={hasResult} />;
}

// Tool Call カード。デフォルトは折りたたみ（ヘッダークリックで Arguments / Result を開閉）。
function ToolInvocationCard({
  toolName,
  args,
  result,
  hasResult,
}: {
  toolName: string;
  args: unknown;
  result: string;
  hasResult: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hasBody = !!args || !!result;

  return (
    <div
      className={`
        my-2 overflow-hidden rounded-lg border border-border bg-card/50
        dark:bg-card/30
      `}
    >
      {/* Header (clickable to expand/collapse) */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        disabled={!hasBody}
        className={`
          flex w-full items-center gap-2 border-b border-border bg-muted/30 px-3 py-2
          text-left transition-colors
          hover:bg-muted/40
          disabled:cursor-default
          dark:bg-muted/20
        `}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
            !hasBody && 'opacity-0'
          )}
        />
        <Wrench className="size-4 text-muted-foreground" />
        <span className="body-secondary">{t('Tool Call')}</span>
        <Badge variant="default" className="code">
          {toolName}
        </Badge>
        {hasResult ? (
          <CheckCircle2
            className={`
              ml-auto size-4 text-green-500
              dark:text-green-400
            `}
          />
        ) : (
          <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <>
          {/* Arguments Section */}
          {!!args && (
            <div
              className={`
                border-b border-border
                last:border-b-0
              `}
            >
              <div className="flex items-center gap-1.5 bg-muted/20 caption-01 px-3 py-1.5">
                <ChevronRight className="size-3" />
                {t('Arguments')}
              </div>
              <CodeBlock code={JSON.stringify(args, null, '  ')} />
            </div>
          )}

          {/* Result Section */}
          {result && (
            <div>
              <div className="flex items-center gap-1.5 bg-muted/20 caption-01 px-3 py-1.5">
                <ChevronRight className="size-3" />
                {t('Result')}
              </div>
              <CodeBlock code={result} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChatMessageContent({
  id,
  role,
  threadId,
  resourceId,
  content,
  type = 'default',
}: ChatMessageEvent) {
  const isUser = role === 'user';
  const Icon = useMemo(() => {
    if (isUser) {
      return User;
    } else if (role === 'system') {
      return Cog;
    } else if (role === 'reasoning') {
      return Brain;
    } else if (content.parts.some(({ type }) => type === 'tool-invocation')) {
      return Hammer;
    } else {
      return Bot;
    }
  }, [role, content.parts]);

  return (
    <div
      className={cn('flex gap-3 rounded-lg p-4', isUser ? 'bg-card' : '')}
      data-message-id={id}
      data-thread-id={threadId}
      data-resource-id={resourceId}
      data-testid={`${type}-${role}-message-${id}`}
    >
      <div className="shrink-0">
        <div
          className={cn(
            'flex size-8 items-center justify-center rounded-full',
            isUser
              ? 'bg-primary text-primary-foreground'
              : role === 'assistant'
                ? 'bg-secondary text-secondary-foreground'
                : role === 'reasoning'
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-accent text-accent-foreground'
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="mn-label capitalize">{role}</span>
        </div>
        <div
          className={`
            overflow-hidden body text-wrap break-words
            [line-break:anywhere]
          `}
        >
          {content.parts.map((part, i) => (
            <UniversalContentPart key={i} part={part} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatMessage(props: ChatMessageEvent) {
  const { t } = useTranslation();
  return (
    <ChatMessageErrorBoundary message={props} title={t('Failed to render message')}>
      <ChatMessageContent {...props} />
    </ChatMessageErrorBoundary>
  );
}

export const ChatMessageMemo = memo(ChatMessage);
