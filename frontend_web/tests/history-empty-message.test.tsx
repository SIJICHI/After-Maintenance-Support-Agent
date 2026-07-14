import { describe, it, expect } from 'vitest';
import { selectMessages } from '@/api/chat/selectors';

const base = {
  name: null,
  encryptedValue: null,
  inProgress: false,
  error: null,
  toolCalls: null,
  timestamp: 1,
};

const wrap = (messages: any[]) => ({ data: { messages } }) as any;

describe('selectMessages history mapping', () => {
  it('空メッセージ（content/toolCalls/error なし）はバブルを出さない', () => {
    const out = selectMessages(wrap([{ ...base, id: 'a1', role: 'assistant', content: null }]));
    expect(out).toHaveLength(0);
  });

  it('"Unsupported content type" は決して出力しない', () => {
    const out = selectMessages(
      wrap([
        { ...base, id: 'a1', role: 'assistant', content: null },
        { ...base, id: 'a2', role: 'reasoning', content: null },
      ])
    );
    const texts = out.flatMap(m => m.content.parts.map(p => (p.type === 'text' ? p.text : '')));
    expect(texts).not.toContain('Unsupported content type');
  });

  it('name の無い壊れたツールコール片は描画しない', () => {
    const out = selectMessages(
      wrap([
        {
          ...base,
          id: 'a1',
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 't1', function: { name: undefined, arguments: '"1\\"}"' } }],
        },
      ])
    );
    expect(out).toHaveLength(0);
  });

  it('error フィールドはメッセージとして表示する', () => {
    const out = selectMessages(
      wrap([{ ...base, id: 'a1', role: 'assistant', content: null, error: '実行エラー' }])
    );
    expect(out).toHaveLength(1);
    expect(out[0].content.parts[0]).toMatchObject({ type: 'text', text: '実行エラー' });
  });
});
