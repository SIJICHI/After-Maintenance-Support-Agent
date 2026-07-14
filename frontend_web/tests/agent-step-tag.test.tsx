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

// 全プロセスタグ（[..]形式）のテキストを収集する。カード側(div)・ヘッダ側(span)双方を拾う。
const tagsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('div,span'))
    .map(e => (e.textContent || '').trim())
    .filter(txt => /^\[[^[\]]*\]$/.test(txt));

describe('AGENT step tag matches process map', () => {
  const events = [
    ev('u0', 'user', 'FSE0001'),
    ev('u1', 'user', '内視鏡が映らない'),
    ev('a1', 'assistant', '一次切り分けです。\n[[triage]]\n推定原因: X\n[[/triage]]'),
    ev('a2', 'assistant', '再度の切り分けです。\n[[triage]]\n推定原因: Y\n[[/triage]]'),
  ];

  it('computeProcessSteps numbers duplicate labels', () => {
    const steps = computeProcessSteps(events, (s: string) => s);
    expect(steps.find(s => s.id === 'a2' && s.artifact === 'triage')?.label).toBe(
      '原因切り分け (2)'
    );
  });

  it('artifact card carries the exact process-map label (incl. numbering)', () => {
    const { container } = render(
      <ProcessStepsProvider events={events}>
        <ChatMessage {...events[3].value} />
      </ProcessStepsProvider>
    );
    expect(tagsOf(container)).toContain('[原因切り分け (2)]');
  });

  it('every artifact in a multi-card message gets its own tag', () => {
    // 1メッセージにトリアージ＋作業手順が同居 → プロセスマップは2項目 → 右側も2タグ必須。
    const multi = [
      ev('u0', 'user', 'FSE0001'),
      ev('u1', 'user', '内視鏡が映らない'),
      ev(
        'a1',
        'assistant',
        '対応です。\n[[triage]]\n推定原因: X\n[[/triage]]\n[[steps]]\n点検|送水確認|!感電注意\n[[/steps]]'
      ),
    ];
    const { container } = render(
      <ProcessStepsProvider events={multi}>
        <ChatMessage {...multi[2].value} />
      </ProcessStepsProvider>
    );
    const tags = tagsOf(container);
    expect(tags).toContain('[原因切り分け]');
    expect(tags).toContain('[作業手順]');
  });
});
