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
        value={userInput}
        onChange={e => setUserInput(e.target.value)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onKeyDown={keyDownHandler}
        className="h-auto min-h-20 flex-1 shrink-0 resize-none overflow-x-hidden overflow-y-auto pr-12"
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
          <TooltipContent>{t('Agent is running')}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          type="submit"
          onClick={() => onSubmit(userInput)}
          className="absolute right-2 bottom-2"
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
