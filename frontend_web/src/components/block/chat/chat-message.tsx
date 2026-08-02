import {
  memo,
  useMemo,
  useState,
  useRef,
  Component,
  createContext,
  useContext,
  type ReactNode,
  type ErrorInfo,
} from 'react';
import { Wrench, ChevronRight, CheckCircle2, Loader2, AlertTriangle, Download } from 'lucide-react';
import { CodeBlock } from '@/components/ui/code-block';
import { cn } from '@/lib/utils';
import type { ContentPart, ToolInvocationUIPart, ChatMessageEvent } from './types';
import { useStepLabel } from './process-map';
import { useChatContext } from '@/components/block/chat/hooks/use-chat-context';
import { Badge } from '@/components/ui/badge';
import { Markdown } from '@/components/block/markdown';
import { useTranslation } from '@/lib/i18n';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
// 構成図SVGはViteアセットとしてimportし、dev/デプロイ(ベースパス配下)双方で正しいURLを得る。
import componentDiagramUrl from '@/assets/component_diagram.svg?url';

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
const TRIAGE_REGEX = /\[\[triage\]\]\s*([\s\S]*?)\s*\[\[\/triage\]\]/;
const SOURCES_REGEX = /\[\[sources\]\]\s*([\s\S]*?)\s*\[\[\/sources\]\]/;

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

interface TriageField {
  label: string;
  value: string;
}

// [[triage]] を「区分: 内容」行として順序保持で解析する（区分名は可変＝方針の名称が persona で変わる）。
function parseTriage(content: string): { rest: string; fields: TriageField[] | null } {
  const match = content.match(TRIAGE_REGEX);
  if (!match) {
    return { rest: content, fields: null };
  }
  const fields: TriageField[] = match[1]
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const idx = line.search(/[:：]/);
      if (idx < 0) return { label: '', value: line };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter(f => f.label || f.value);
  return { rest: content.replace(TRIAGE_REGEX, '').trimEnd(), fields };
}

interface SourceRef {
  label: string;
  content: string;
  image?: string; // 図面・画像のURL（モーダルで表示）
}

// 既知の参照アセット（ファイル名 → Viteが解決した実URL）。エージェントがFSパスや
// 任意ディレクトリのパスを返しても、ファイル名で正しい配信URLにマップする。
const KNOWN_ASSET_URLS: Record<string, string> = {
  'component_diagram.svg': componentDiagramUrl,
};

// ラベルのキーワード → 既知アセットURL（本文に画像パスが無くてもラベルから推定）。
const SOURCE_ASSETS: { keyword: RegExp; url: string }[] = [
  { keyword: /構成図|component_diagram|図面/, url: componentDiagramUrl },
];

// 画像パスを表示用URLに解決する。既知アセットはファイル名でViteの実URLに差し替える。
function resolveAssetUrl(path: string): string {
  const file =
    path
      .split(/[\\/?#]/)
      .filter(Boolean)
      .pop() || path;
  if (KNOWN_ASSET_URLS[file]) return KNOWN_ASSET_URLS[file];
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('/')) {
    return path;
  }
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}/${path}`;
}

function resolveSourceImage(label: string, content: string): string | undefined {
  // 本文に「画像:」「image:」でURLが明示されていればそれを使う
  const m = content.match(/^\s*(?:画像|image)\s*[:：]\s*(\S+)\s*$/im);
  if (m) return m[1];
  // ラベルから既知アセットを推定
  for (const a of SOURCE_ASSETS) {
    if (a.keyword.test(label)) return a.url;
  }
  return undefined;
}

// [[sources]] を「### ラベル」見出し＋本文のブロックとして解析する。
function parseSources(content: string): { rest: string; sources: SourceRef[] | null } {
  const match = content.match(SOURCES_REGEX);
  if (!match) {
    return { rest: content, sources: null };
  }
  const body = match[1];
  const sources: SourceRef[] = [];
  const parts = body.split(/^###\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf('\n');
    const label = nl < 0 ? trimmed : trimmed.slice(0, nl).trim();
    let body2 = nl < 0 ? '' : trimmed.slice(nl + 1).trim();
    const image = resolveSourceImage(label, body2);
    // 「画像:」行は本文表示から除く
    body2 = body2.replace(/^\s*(?:画像|image)\s*[:：]\s*\S+\s*$/im, '').trim();
    sources.push({ label, content: body2, image });
  }
  return {
    rest: content.replace(SOURCES_REGEX, '').trimEnd(),
    sources: sources.length ? sources : null,
  };
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
  triage: TriageField[] | null;
  sources: SourceRef[] | null;
} {
  const stepsResult = parseSteps(content);
  const rseActionsResult = parseRseActions(stepsResult.rest);
  const hearingResult = parseHearing(rseActionsResult.rest);
  const triageResult = parseTriage(hearingResult.rest);
  const sourcesResult = parseSources(triageResult.rest);
  const briefingResult = parseBriefing(sourcesResult.rest);
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
    triage: triageResult.fields,
    sources: sourcesResult.sources,
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

// 局面①の顧客ヒアリング表。RSEが電話しながら確認結果(メモ)を記入でき、
// エージェント提示の項目に加えてRSE独自の確認項目を追加・編集・削除できる。状態はlocalStorage保存。
interface HearingRow {
  item: string;
  details: string[];
  memo: string;
  checked: boolean;
}

// 成果物カード共通シェル（1b Ops Console）。左1pxのステータスレール＋大文字ヘッダ。
// 各成果物カードから、自身が属するメッセージIDを参照できるようにする（プロセスタグ算出用）。
const MessageIdContext = createContext<string>('');

// 成果物(artifact)ごとのプロセスステップタグ。プロセスマップの対応行と完全一致（連番込み）。
// 該当ステップが無い成果物（例: 情報源）では何も描画しない。
function ArtifactStepTag({ artifact }: { artifact: string }) {
  const id = useContext(MessageIdContext);
  const label = useStepLabel(id, artifact);
  if (!label) return null;
  return (
    <div className="mt-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--green-40)]">
      [{label}]
    </div>
  );
}

// rail: 'green'=情報/成果物系, 'purple'=フォーム系（派遣ブリーフィング/ネクストアクション/引き継ぎ）。
function CardShell({
  rail = 'green',
  title,
  right,
  children,
}: {
  rail?: 'green' | 'purple';
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const railColor = rail === 'purple' ? 'bg-[var(--accent)]' : 'bg-[var(--green-40)]';
  const titleColor = rail === 'purple' ? 'text-[var(--accent)]' : 'text-[var(--green-40)]';
  return (
    <div className="my-2 flex overflow-hidden rounded-md border border-border bg-card">
      <span className={cn('w-px shrink-0', railColor)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className={cn('text-[11px] font-semibold tracking-[0.06em] uppercase', titleColor)}>
            {title}
          </span>
          {right}
        </div>
        {children}
      </div>
    </div>
  );
}

// 注意事項セル（読取専用）。各項目はセミコロン区切り。先頭が「!」の項目は安全重要事項として
// 警告アイコン＋黄色で強調する。
// 【安全表示は不可侵】この安全ハイライト（!→⚠️黄色）は患者・ユーザー・作業員の安全に直結する
// ため、決して削除・無効化しないこと。回帰テスト notes-cell.test.tsx で保護している。
export function NotesCell({ notes }: { notes: string }) {
  const items = notes
    .split(/[;；\n]/)
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
              data-testid="safety-note"
              className={`
                flex items-start gap-1.5 rounded border border-yellow-400/50 bg-yellow-500/15
                px-2 py-1 text-yellow-300
              `}
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

// 編集可能なチェックリスト表。項目/詳細を編集でき、行の追加・削除・チェックができる。
// 注意事項列は notesMode で切替: 'highlight'=安全ハイライト読取専用(作業チェック表),
// 'edit'=編集可能テキスト(ヒアリングのメモ等)。
function StepChecklist({
  steps,
  completeQuestion,
  completeChoices,
  title,
  itemHeader,
  detailsHeader,
  notesHeader,
  storageNs = 'steps',
  submit,
  notesMode = 'highlight',
  notesPlaceholder,
}: {
  steps: StepRow[];
  completeQuestion?: string;
  completeChoices?: string[];
  title?: string;
  itemHeader?: string;
  detailsHeader?: string;
  notesHeader?: string;
  storageNs?: string;
  submit?: { label: string; prefix: string };
  notesMode?: 'highlight' | 'edit';
  notesPlaceholder?: string;
}) {
  const { t } = useTranslation();
  const ctx = useChatContext();
  const storageKey = useMemo(
    () => `${ctx.chatId}-${hashKey(steps.map(s => s.item).join('|'))}-${storageNs}`,
    [ctx.chatId, steps, storageNs]
  );
  const [rows, setRows] = useState<HearingRow[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as HearingRow[];
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return steps.map(s => ({ item: s.item, details: s.details, memo: s.notes, checked: false }));
  });

  const persist = (next: HearingRow[]): HearingRow[] => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    return next;
  };
  const updateRow = (i: number, patch: Partial<HearingRow>) =>
    setRows(prev => persist(prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r))));
  const addRow = () =>
    setRows(prev => persist([...prev, { item: '', details: [], memo: '', checked: false }]));
  const removeRow = (i: number) => setRows(prev => persist(prev.filter((_, idx) => idx !== i)));

  const doneCount = rows.filter(r => r.checked).length;
  const allDone = rows.length > 0 && doneCount === rows.length;
  const inputCls =
    'w-full resize-y rounded border border-border bg-background px-2 py-1 text-[12px] text-foreground! focus:border-primary focus:outline-none';
  const hdrCls =
    'border-b border-foreground px-[10px] py-1.5 text-left text-[12px] font-semibold tracking-[0.04em] uppercase text-foreground';

  return (
    <CardShell
      title={title ?? t('作業チェックリスト')}
      right={
        <span className="font-mono text-[9.5px] text-foreground">
          {doneCount}/{rows.length}
        </span>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-foreground!">
          <thead>
            <tr className="bg-muted/40">
              <th className="w-[30px] border-b border-foreground p-1.5" />
              <th className={cn(hdrCls, 'w-48')}>{itemHeader ?? t('作業項目')}</th>
              <th className={hdrCls}>{detailsHeader ?? t('詳細')}</th>
              <th className={hdrCls}>{notesHeader ?? t('注意事項')}</th>
              <th className="w-8 border-b border-foreground p-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                <td className="border-b border-border/50 px-1.5 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => updateRow(i, { checked: !row.checked })}
                    className={`
                      mt-1 inline-flex size-4 items-center justify-center rounded
                      border-[1.5px] border-foreground bg-transparent text-[10px]
                    `}
                    aria-label="toggle"
                  >
                    {row.checked && <span className="font-bold text-[var(--green-40)]">✓</span>}
                  </button>
                </td>
                <td
                  className={cn(
                    'border-b border-border/50 px-[10px] py-2',
                    row.checked && 'bg-[color-mix(in_oklch,var(--green-40)_16%,transparent)]'
                  )}
                >
                  <textarea
                    value={row.item}
                    rows={1}
                    placeholder={itemHeader ?? t('作業項目')}
                    onChange={e => updateRow(i, { item: e.target.value })}
                    className={cn(inputCls, 'font-semibold')}
                  />
                </td>
                <td className="border-b border-border/50 px-[10px] py-2">
                  <textarea
                    value={row.details.join('\n')}
                    rows={Math.max(2, row.details.length)}
                    placeholder={t('詳細（1行に1項目）')}
                    onChange={e =>
                      updateRow(i, {
                        details: e.target.value
                          .split('\n')
                          .map(s => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className={inputCls}
                  />
                </td>
                <td className="border-b border-border/50 px-[10px] py-2">
                  {notesMode === 'edit' ? (
                    <textarea
                      value={row.memo}
                      rows={2}
                      placeholder={notesPlaceholder ?? t('メモ')}
                      onChange={e => updateRow(i, { memo: e.target.value })}
                      className={inputCls}
                    />
                  ) : (
                    <NotesCell notes={row.memo} />
                  )}
                </td>
                <td className="border-b border-border/50 px-1 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                    title={t('行を削除')}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/50 p-2">
        <button
          type="button"
          onClick={addRow}
          className={`
            rounded border border-dashed border-muted-foreground/60 px-3 py-1.5 text-[11.5px]
            text-muted-foreground
            hover:bg-accent hover:text-accent-foreground
          `}
        >
          {t('+ 行を追加')}
        </button>
        {submit && (
          <button
            type="button"
            disabled={ctx.isAgentRunning}
            onClick={() => {
              const body = rows
                .map(
                  r =>
                    `- ${r.item}（観点: ${r.details.join('、') || '—'}）→ 結果: ${r.memo || '（未確認）'}`
                )
                .join('\n');
              ctx.sendMessage(`${submit.prefix}\n${body}`);
            }}
            className={cn(
              'rounded bg-[var(--green-50)] px-[13px] py-1.5 text-[11.5px] font-bold text-black hover:opacity-90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {submit.label}
          </button>
        )}
      </div>
      {allDone && completeChoices && completeChoices.length > 0 && (
        <div className="border-t border-border/50 bg-muted/20 p-3">
          {completeQuestion && (
            <div className="mb-2 text-[13px] font-semibold">{completeQuestion}</div>
          )}
          <QuickReplies choices={completeChoices} />
        </div>
      )}
    </CardShell>
  );
}

function QuickReplies({ choices }: { choices: string[] }) {
  const { sendMessage, setUserInput, isAgentRunning } = useChatContext();
  const { t } = useTranslation();
  // 押されたチップだけをハイライト（設問=このメッセージ単位で排他）。
  const [selected, setSelected] = useState<number | null>(null);

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
    <div className="mt-3 flex flex-wrap gap-[7px]">
      {visibleChoices.map((choice, i) => {
        const isSel = selected === i;
        return (
          <button
            key={i}
            type="button"
            disabled={isAgentRunning}
            onClick={() => {
              setSelected(i);
              sendMessage(choice);
            }}
            className={cn(
              'rounded border border-[var(--azure-50)] px-3 py-1.5 text-[12px] transition-colors',
              isSel
                ? 'bg-[var(--azure-50)] font-bold text-black'
                : 'bg-[color-mix(in_oklch,var(--azure-50)_10%,transparent)] text-foreground hover:bg-[color-mix(in_oklch,var(--azure-50)_22%,transparent)]',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {choice}
          </button>
        );
      })}
      <button
        type="button"
        disabled={isAgentRunning}
        onClick={onOther}
        className={cn(
          `
            rounded border border-dashed border-muted-foreground px-3 py-1.5 text-[12px]
            text-muted-foreground transition-colors
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

// トリアージ表（現時点の推定原因・類似傾向）の編集カード。区分ごとの内容を編集できる。
// 参照情報源カード。箇条書きで一覧表示し、各リンクのクリックで中身を別モーダルに表示する
// （チャットを長くしないため、本文はモーダル側に出す）。
// 情報源ラベルからモノバッジ種別（CSV/DB/MD/SVG/DOC/REF）を推定する。
function sourceBadge(s: SourceRef): string {
  const l = s.label;
  if (s.image || /構成図|diagram|\.svg/i.test(l)) return 'SVG';
  if (/エラーコード表|error_codes|\.csv/i.test(l)) return 'CSV';
  if (/修理履歴|repair_history|履歴DB|DB/i.test(l)) return 'DB';
  if (/マニュアル|manual|\.md|インタビュー|ベテラン/i.test(l)) return 'MD';
  if (/報告書|report|\.doc/i.test(l)) return 'DOC';
  return 'REF';
}

function SourcesCard({ sources }: { sources: SourceRef[] }) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const active = openIndex !== null ? sources[openIndex] : null;

  return (
    <CardShell title={t('参照情報源')}>
      <div className="px-3 pt-1 pb-2">
        {sources.map((s, i) => {
          const hasDetail = !!s.content || !!s.image;
          return (
            <div
              key={i}
              className="flex items-center gap-[9px] border-b border-border/50 py-1.5 last:border-b-0"
            >
              <span
                className={`
                  w-10 shrink-0 rounded border border-border px-[5px] py-[2px] text-center
                  font-mono text-[9px] text-[var(--azure-50)]
                `}
              >
                {sourceBadge(s)}
              </span>
              <button
                type="button"
                onClick={() => hasDetail && setOpenIndex(i)}
                className={cn(
                  'text-left text-[12px] text-foreground',
                  hasDetail ? 'hover:underline' : 'pointer-events-none'
                )}
              >
                {hasDetail && <span className="mr-[5px]">🔗</span>}
                {s.label}
              </button>
            </div>
          );
        })}
      </div>
      <Dialog open={openIndex !== null} onOpenChange={open => !open && setOpenIndex(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{active?.label}</DialogTitle>
          </DialogHeader>
          {active?.content && (
            <div className="body-secondary text-foreground!">
              <Markdown>{active.content}</Markdown>
            </div>
          )}
          {active?.image && (
            <img
              src={resolveAssetUrl(active.image)}
              alt={active.label}
              className="mt-2 w-full rounded-md border border-border bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </CardShell>
  );
}

function TriageCard({ fields }: { fields: TriageField[] }) {
  const { t } = useTranslation();
  const { chatId } = useChatContext();
  const storageKey = useMemo(
    () => `${chatId}-${hashKey(fields.map(f => f.label).join('|'))}-triage`,
    [chatId, fields]
  );
  const [values, setValues] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as string[];
          if (Array.isArray(parsed) && parsed.length === fields.length) return parsed;
        }
      } catch {
        // ignore
      }
    }
    return fields.map(f => f.value);
  });
  const setValue = (i: number, v: string) =>
    setValues(prev => {
      const next = prev.map((x, idx) => (idx === i ? v : x));
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  const inputCls =
    'w-full resize-y rounded border border-border bg-background px-2 py-1 text-[12.5px] text-foreground! focus:border-primary focus:outline-none';

  return (
    <CardShell
      title={t('現時点の推定原因・類似傾向')}
      right={<span className="font-mono text-[9.5px] text-foreground">TRIAGE</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-foreground!">
          <tbody>
            {fields.map((f, i) => (
              <tr key={i} className="align-top">
                <th
                  className={`
                    w-24 border-b border-border/50 bg-muted/40 px-3 py-[7px] text-left
                    text-[11.5px] font-normal text-foreground
                  `}
                >
                  {f.label}
                </th>
                <td className="border-b border-border/50 px-3 py-[7px]">
                  <textarea
                    value={values[i] ?? ''}
                    rows={2}
                    onChange={e => setValue(i, e.target.value)}
                    className={inputCls}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
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
    { key: 'dispatch_id', label: t('ディスパッチ番号'), multiline: false },
    { key: 'symptom', label: t('申告症状'), multiline: true },
    { key: 'diagnosis', label: t('推定原因・所見'), multiline: true },
    { key: 'initial_response', label: t('実施済みの初動対応'), multiline: true },
    { key: 'parts_to_bring', label: t('持参・準備部品（;区切り）'), multiline: true },
    { key: 'focus_points', label: t('FSEへの重点指示（;区切り）'), multiline: true },
    { key: 'notes', label: t('申し送り'), multiline: true },
  ];

  const inputCls =
    'w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground! focus:border-primary focus:outline-none disabled:opacity-60';

  return (
    <CardShell rail="purple" title={t('FSE派遣ブリーフィング（リリース前に確認・編集）')}>
      <div className="flex flex-col gap-3 p-3">
        {rows.map(({ key, label, multiline }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--green-40)]">{label}</span>
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
                className={cn(inputCls, 'font-mono')}
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
                'rounded bg-[var(--purple-60)] px-[14px] py-1.5 text-[11.5px] font-bold text-white hover:opacity-90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {t('FSEに派遣情報をリリース')} →
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-[var(--accent)]">{t('FSEへリリース済み')}</div>
        )}
      </div>
    </CardShell>
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
        idx === i
          ? {
              ...r,
              details: v
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            }
          : r
      )
    );
  const setNotes = (i: number, v: string) =>
    setRows(prev =>
      prev.map((r, idx) =>
        idx === i
          ? {
              ...r,
              notes: v
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .join(';'),
            }
          : r
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
    const pipe = valid.map(r => `${r.item} | ${r.details.join(';')} | ${r.notes}`).join('\n');
    sendMessage(`以下のネクストアクションをFSEにリリースしてください。\n${pipe}`);
  };

  const inputCls =
    'w-full resize-y rounded border border-border bg-background px-2 py-1 body-secondary text-foreground! focus:border-primary focus:outline-none disabled:opacity-60';

  return (
    <CardShell rail="purple" title={t('FSEへのネクストアクション（編集・リリース）')}>
      <div className="flex flex-col gap-3 p-3">
        {rows.map((row, i) => (
          <div key={i} className="rounded-md border border-border p-2">
            <div className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <input
                  type="text"
                  value={row.item}
                  disabled={released || isAgentRunning}
                  placeholder={t('作業項目')}
                  onChange={e => setItem(i, e.target.value)}
                  className={cn(inputCls, 'font-medium')}
                />
                <textarea
                  value={row.details.join('\n')}
                  disabled={released || isAgentRunning}
                  placeholder={t('詳細（1行に1項目）')}
                  rows={Math.max(2, row.details.length)}
                  onChange={e => setDetails(i, e.target.value)}
                  className={inputCls}
                />
                <textarea
                  value={row.notes.split(/[;；]/).filter(Boolean).join('\n')}
                  disabled={released || isAgentRunning}
                  placeholder={t('注意事項（1行に1項目、安全は先頭に!）')}
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
                  title={t('行を削除')}
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
              {t('+ 行を追加')}
            </button>
            <button
              type="button"
              onClick={onRelease}
              disabled={isAgentRunning}
              className={cn(
                'rounded bg-[var(--purple-60)] px-[14px] py-1.5 text-[11.5px] font-bold text-white hover:opacity-90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {t('FSEにリリース')} →
            </button>
          </div>
        )}
        {released && (
          <div className="text-[11px] text-[var(--accent)]">{t('FSEへリリース済み')}</div>
        )}
      </div>
    </CardShell>
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
    { key: 'parent_dispatch_id', label: t('案件ディスパッチ番号（親）') },
    { key: 'summary', label: t('要約') },
    { key: 'error_codes', label: t('関連エラーコード') },
    { key: 'recommended_parts', label: t('推奨部品') },
    { key: 'open_questions', label: t('未解決の確認事項') },
  ];

  return (
    <CardShell rail="purple" title={t('HQ引き継ぎ要約（発行前に確認・編集）')}>
      <div className="flex flex-col gap-3 p-3">
        {rows.map(({ key, label }) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--green-40)]">{label}</span>
            <textarea
              value={fields[key]}
              disabled={issued || isAgentRunning}
              onChange={e => update(key, e.target.value)}
              rows={key === 'summary' || key === 'open_questions' ? 3 : 1}
              className={cn(
                'w-full resize-y rounded border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground! focus:border-primary focus:outline-none disabled:opacity-60',
                key === 'parent_dispatch_id' && 'font-mono'
              )}
            />
          </label>
        ))}
        <div>
          <button
            type="button"
            disabled={issued || isAgentRunning}
            onClick={onIssue}
            className={cn(
              'rounded bg-[var(--purple-60)] px-[14px] py-1.5 text-[11.5px] font-bold text-white transition-colors hover:opacity-90',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {issued ? t('発行中…') : `${t('この内容で相談票を発行')} →`}
          </button>
        </div>
      </div>
    </CardShell>
  );
}

// 報告書ドラフトのカード表示。Markdownで描画し、その描画HTMLをWord(.doc)として出力する。
// SR報告書ドラフトのカード。編集（Markdown）とプレビューを切り替えでき、
// Wordダウンロードは常に編集後の内容を使う（基本思想: 出力はドラフト、確定は人間）。
function ReportCard({ report, dispatchId }: { report: string; dispatchId?: string }) {
  const { t } = useTranslation();
  const { chatId } = useChatContext();
  const previewRef = useRef<HTMLDivElement>(null);
  const storageKey = useMemo(() => `${chatId}-${hashKey(report)}-report`, [chatId, report]);
  const [draft, setDraft] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) return saved;
      } catch {
        // ignore
      }
    }
    return report;
  });
  const [editing, setEditing] = useState(false);

  const onChange = (v: string) => {
    setDraft(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      // ignore
    }
  };

  const onDownload = () => {
    const html = previewRef.current?.innerHTML ?? '';
    const today = new Date().toISOString().slice(0, 10);
    const filename = dispatchId
      ? `service_report_${dispatchId}_${today}.doc`
      : `service_report_${today}.doc`;
    downloadAsWord(filename, html);
  };

  return (
    <CardShell
      title={t('サービス報告書ドラフト')}
      right={
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing(e => !e)}
            className="rounded border border-border bg-transparent px-[10px] py-1 text-[11px] text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            {editing ? t('プレビュー') : t('編集')}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="flex items-center gap-1.5 rounded bg-[var(--green-50)] px-[10px] py-1 text-[11px] font-bold text-black hover:opacity-90"
          >
            <Download className="size-3" />
            {t('Word出力')}
          </button>
        </span>
      }
    >
      {editing && (
        <textarea
          value={draft}
          onChange={e => onChange(e.target.value)}
          className={`
            min-h-64 w-full resize-y border-b border-border bg-background px-4 py-3
            text-[12px] text-foreground!
            focus:outline-none
          `}
        />
      )}
      {/* プレビューは常にレンダリングしておき、Wordダウンロード時にこのHTMLを使う */}
      <div ref={previewRef} className={cn('px-4 py-3 text-[12px]', editing && 'hidden')}>
        <Markdown>{draft}</Markdown>
      </div>
    </CardShell>
  );
}

export function TextContentPart({ content }: { content: string }) {
  const { t } = useTranslation();
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
    triage,
    sources,
  } = useMemo(() => parseContent(content ? content : ''), [content]);
  return (
    <>
      <Markdown>{text}</Markdown>
      {triage && triage.length > 0 && (
        <div data-artifact="triage">
          <ArtifactStepTag artifact="triage" />
          <TriageCard fields={triage} />
        </div>
      )}
      {sources && sources.length > 0 && (
        <div data-artifact="sources">
          <ArtifactStepTag artifact="sources" />
          <SourcesCard sources={sources} />
        </div>
      )}
      {steps.length > 0 && (
        <div data-artifact="steps">
          <ArtifactStepTag artifact="steps" />
          <StepChecklist
            steps={steps}
            completeQuestion={completeQuestion}
            completeChoices={completeChoices}
          />
        </div>
      )}
      {hearing && hearing.length > 0 && (
        <div data-artifact="hearing">
          <ArtifactStepTag artifact="hearing" />
          <StepChecklist
            steps={hearing}
            title={t('ヒアリング項目（お客様へ確認）')}
            itemHeader={t('確認項目')}
            detailsHeader={t('確認の観点')}
            notesHeader={t('メモ')}
            notesMode="edit"
            notesPlaceholder={t('確認結果を記入')}
            storageNs="hearing"
            submit={{
              label: t('この結果でトリアージ・レシピを更新'),
              prefix:
                '以下のヒアリング結果です。これを踏まえてトリアージを更新し、FSEへ送るレシピ（派遣ブリーフィング）をドラフトしてください。対象のディスパッチ番号が分かる場合は save_hearing_results で記録してください。',
            }}
          />
        </div>
      )}
      {rseActions && (
        <div data-artifact="rse-actions">
          <ArtifactStepTag artifact="rse-actions" />
          <EditableActionTable rows={rseActions} />
        </div>
      )}
      {briefing && (
        <div data-artifact="briefing">
          <ArtifactStepTag artifact="briefing" />
          <DispatchBriefingCard briefing={briefing} />
        </div>
      )}
      {handoff && (
        <div data-artifact="handoff">
          <ArtifactStepTag artifact="handoff" />
          <HandoffDraftCard handoff={handoff} />
        </div>
      )}
      {report && (
        <div data-artifact="report">
          <ArtifactStepTag artifact="report" />
          <ReportCard report={report} dispatchId={reportDispatchId} />
        </div>
      )}
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

  return (
    <ToolInvocationCard
      toolName={toolInvocation.toolName}
      args={toolInvocation.args}
      result={result}
      hasResult={hasResult}
    />
  );
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
        <span className="body-secondary">{t('ツール呼び出し')}</span>
        <Badge variant="default" className="code">
          {toolName}
        </Badge>
        {hasResult ? (
          <CheckCircle2
            className={`
              ml-auto size-4 text-green-500
              dark:text-[var(--green-40)]
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
                {t('引数')}
              </div>
              <CodeBlock code={JSON.stringify(args, null, '  ')} />
            </div>
          )}

          {/* Result Section */}
          {result && (
            <div>
              <div className="flex items-center gap-1.5 bg-muted/20 caption-01 px-3 py-1.5">
                <ChevronRight className="size-3" />
                {t('結果')}
              </div>
              <CodeBlock code={result} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// アシスタントのメッセージが「ツール呼び出しのみ」かどうか（本文テキストを含まない）。
// これらは処理ログとして畳み込み、メインの会話には出さない。
export function isToolOnlyAssistantMessage(msg: ChatMessageEvent): boolean {
  if (msg.role !== 'assistant') return false;
  const parts = msg.content?.parts ?? [];
  return parts.length > 0 && parts.every(p => p.type === 'tool-invocation');
}

// エージェントの処理ログ（ツール呼び出し群）を1つに畳み込む折りたたみパネル。
// 既定は閉じており、ヘッダークリックで各ツールの引数・結果を確認できる。
export function ToolCallLog({ messages }: { messages: ChatMessageEvent[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toolParts = messages
    .flatMap(m => m.content?.parts ?? [])
    .filter((p): p is ToolInvocationUIPart => p.type === 'tool-invocation');
  if (toolParts.length === 0) return null;
  const running = toolParts.some(p => !p.toolInvocation.result);

  return (
    <div className="my-1.5 flex items-start gap-2.5" data-testid="tool-call-log">
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[5px] bg-muted text-[12px] text-muted-foreground">
        ⚙
      </span>
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card/40 dark:bg-card/20">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className={`
            flex w-full items-center gap-2 px-3 py-2 text-left transition-colors
            hover:bg-muted/30
          `}
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90'
            )}
          />
          <Wrench className="size-4 text-muted-foreground" />
          <span className="text-[12px] font-semibold text-muted-foreground">
            {t('エージェントの処理ログ')}
          </span>
          <Badge variant="default" className="code">
            {`${toolParts.length} ${t('件のツール呼び出し')}`}
          </Badge>
          {running ? (
            <Loader2 className="ml-auto size-4 animate-spin text-muted-foreground" />
          ) : (
            <CheckCircle2 className="ml-auto size-4 text-green-500 dark:text-[var(--green-40)]" />
          )}
        </button>
        {expanded && (
          <div className="border-t border-border px-3 py-2">
            {toolParts.map((part, i) => (
              <ToolInvocationPart key={i} part={part} />
            ))}
          </div>
        )}
      </div>
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
  const { t } = useTranslation();
  // 成果物に紐づかないメッセージ単位ステップ（事案入力/受付/RSE入力/リリース等）。成果物カードの
  // タグは各カード側(ArtifactStepTag)が担当する。
  const messageLevelStep = useStepLabel(id, undefined);
  const isUser = role === 'user';
  const dataAttrs = {
    'data-message-id': id,
    'data-thread-id': threadId,
    'data-resource-id': resourceId,
    'data-testid': `${type}-${role}-message-${id}`,
  };
  const body = (
    <MessageIdContext.Provider value={id}>
      {content.parts.map((part, i) => (
        <UniversalContentPart key={i} part={part} />
      ))}
    </MessageIdContext.Provider>
  );

  if (isUser) {
    return (
      <div className="flex items-start gap-2.5" {...dataAttrs}>
        <span
          className={`
            flex size-[26px] shrink-0 items-center justify-center rounded-[5px]
            border border-[var(--green-40)] bg-muted/30 font-mono text-[10px]
            text-[var(--green-40)]
          `}
        >
          YOU
        </span>
        <div className="min-w-0 flex-1">
          {messageLevelStep && (
            <div className="mb-1 text-[11px] font-semibold tracking-[0.02em] text-[var(--green-40)]">
              [{messageLevelStep}]
            </div>
          )}
          <div
            className={`
              overflow-hidden rounded-[6px] border border-border bg-card px-[13px] py-2
              text-[13px] leading-[1.5] text-foreground break-words [line-break:anywhere]
            `}
          >
            {body}
          </div>
        </div>
      </div>
    );
  }

  const isAssistant = role === 'assistant';
  const stepLabel = isAssistant ? messageLevelStep : null;
  return (
    <div className="flex items-start gap-2.5" {...dataAttrs}>
      <span
        className={cn(
          'flex size-[26px] shrink-0 items-center justify-center rounded-[5px] text-[12px] font-bold',
          isAssistant ? 'bg-[var(--green-50)] text-black' : 'bg-muted text-muted-foreground'
        )}
      >
        {isAssistant ? '◆' : role === 'reasoning' ? '…' : '•'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[12px] font-semibold text-foreground uppercase">
            {isAssistant ? 'AGENT' : role}
          </span>
          {isAssistant && stepLabel && (
            <span className="text-[11px] font-semibold tracking-[0.02em] text-[var(--green-40)]">
              [{stepLabel}]
            </span>
          )}
          {isAssistant && (
            <span className="rounded border border-border px-[5px] font-mono text-[9.5px] tracking-[0.05em] text-foreground uppercase">
              DRAFT
            </span>
          )}
        </div>
        <div className="overflow-hidden text-[13px] leading-[1.6] text-foreground break-words [line-break:anywhere]">
          {body}
        </div>
      </div>
    </div>
  );
}

export function ChatMessage(props: ChatMessageEvent) {
  const { t } = useTranslation();
  return (
    <ChatMessageErrorBoundary message={props} title={t('メッセージの表示に失敗しました')}>
      <ChatMessageContent {...props} />
    </ChatMessageErrorBoundary>
  );
}

export const ChatMessageMemo = memo(ChatMessage);
