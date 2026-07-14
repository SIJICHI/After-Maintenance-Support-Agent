import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChatMessage } from '@/components/block/chat/chat-message';
import { computeProcessSteps, ProcessStepsProvider } from '@/components/block/chat/process-map';

const ev = (id: string, role: string, text: string) =>
  ({
    type: 'message',
    value: {
      id,
      role,
      threadId: 't',
      resourceId: 'r',
      content: { format: 2, parts: [{ type: 'text', text }] },
    },
  }) as any;

const events = [
  ev('u0', 'user', 'FSE0001'),
  ev('u1', 'user', '内視鏡が映らない'),
  ev('a1', 'assistant', '一次切り分けです。\n[[triage]]\n推定原因: X\n[[/triage]]'),
  ev('a2', 'assistant', '再度の切り分けです。\n[[triage]]\n推定原因: Y\n[[/triage]]'),
];

describe('AGENT step tag matches process map', () => {
  it('computeProcessSteps numbers duplicates', () => {
    const steps = computeProcessSteps(events, (s: string) => s);
    expect(steps.find(s => s.id === 'a2')?.label).toBe('原因切り分け (2)');
  });

  it('AGENT header tag equals the process-map label (incl. numbering)', () => {
    const { container } = render(
      <ProcessStepsProvider events={events}>
        <ChatMessage {...events[3].value} />
      </ProcessStepsProvider>
    );
    const tag = Array.from(container.querySelectorAll('span')).find(e =>
      /^\[.*\]$/.test((e.textContent || '').trim())
    );
    expect(tag?.textContent?.trim()).toBe('[原因切り分け (2)]');
  });
});
