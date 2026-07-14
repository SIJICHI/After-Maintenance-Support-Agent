import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';

export interface ChatTextInputProps {
  onSubmit: (text: string) => Promise<unknown>;
  userInput: string;
  setUserInput: (value: string) => void;
  runningAgent: boolean;
}

export function ChatTextInput({
  onSubmit,
  userInput,
  setUserInput,
  runningAgent,
}: ChatTextInputProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  function keyDownHandler(e: KeyboardEvent) {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !isComposing &&
      !runningAgent &&
      userInput.trim().length
    ) {
      if (e.ctrlKey || e.metaKey) {
        const el = ref.current;
        e.preventDefault();
        if (el) {
          const start = el.selectionStart;
          const end = el.selectionEnd;

          const newValue = userInput.slice(0, start) + '\n' + userInput.slice(end);
          setUserInput(newValue);
        }
      } else {
        e.preventDefault();
        onSubmit(userInput);
      }
    }
  }

  return (
    <div className="relative shrink-0">
      <Textarea
        ref={ref}
        data-chat-input="true"
        placeholder={t('メッセージを入力…（一覧にない場合は「その他」を選んで記述）')}
        value={userInput}
        onChange={e => setUserInput(e.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onKeyDown={keyDownHandler}
        className="h-auto min-h-12 flex-1 shrink-0 resize-none overflow-x-hidden overflow-y-auto rounded-[7px] border-border bg-card pr-12 text-[12.5px]"
      ></Textarea>
      {runningAgent ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute right-2 bottom-2">
              <Button testId="send-message-disabled-btn" type="submit" size="icon" disabled>
                <Loader2 className="animate-spin" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t('エージェント実行中')}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          type="submit"
          onClick={() => onSubmit(userInput)}
          className="absolute right-2 bottom-2 bg-[var(--green-50)] text-black hover:opacity-90"
          size="icon"
          testId="send-message-btn"
          disabled={!userInput.trim().length}
        >
          <Send />
        </Button>
      )}
    </div>
  );
}
