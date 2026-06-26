import { memo, useMemo, useState, Component, type ReactNode, type ErrorInfo } from 'react';
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

function parseContent(content: string): {
  text: string;
  steps: StepRow[];
  question: string;
  choices: string[];
} {
  const stepsResult = parseSteps(content);
  const choicesResult = parseChoices(stepsResult.rest);
  return {
    text: choicesResult.rest,
    steps: stepsResult.rows,
    question: choicesResult.question,
    choices: choicesResult.choices,
  };
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

function StepChecklist({ steps }: { steps: StepRow[] }) {
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

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card/50">
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2
          caption-01 text-muted-foreground
        `}
      >
        <CheckCircle2 className="size-4" />
        {t('Work checklist')} ({doneCount}/{steps.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse body-secondary">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left">
              <th className="w-10 px-2 py-2 text-center">✓</th>
              <th className="px-3 py-2">{t('Step')}</th>
              <th className="px-3 py-2">{t('Details')}</th>
              <th className="px-3 py-2">{t('Notes')}</th>
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
    </div>
  );
}

function QuickReplies({ choices }: { choices: string[] }) {
  const { sendMessage, isAgentRunning } = useChatContext();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {choices.map((choice, i) => (
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
    </div>
  );
}

export function TextContentPart({ content }: { content: string }) {
  const { text, steps, question, choices } = useMemo(
    () => parseContent(content ? content : ''),
    [content]
  );
  return (
    <>
      <Markdown>{text}</Markdown>
      {steps.length > 0 && <StepChecklist steps={steps} />}
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
    <div
      className={`
        my-2 overflow-hidden rounded-lg border border-border bg-card/50
        dark:bg-card/30
      `}
    >
      {/* Header */}
      <div
        className={`
          flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2
          dark:bg-muted/20
        `}
      >
        <Wrench className="size-4 text-muted-foreground" />
        <span className="body-secondary">{t('Tool Call')}</span>
        <Badge variant="default" className="code">
          {toolInvocation.toolName}
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
      </div>

      {/* Arguments Section */}
      {toolInvocation.args && (
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
          <CodeBlock code={JSON.stringify(toolInvocation.args, null, '  ')} />
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
