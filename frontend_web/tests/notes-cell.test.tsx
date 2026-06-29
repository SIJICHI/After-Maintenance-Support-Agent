import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { NotesCell } from '@/components/block/chat/chat-message';

// 【安全表示は不可侵】注意事項の「!」始まり項目が安全アラート（⚠️黄色）として描画されることを保証する。
// 患者・ユーザー・作業員の安全に直結するため、このテストは決して削除しないこと。
describe('NotesCell 安全アラート（不可侵）', () => {
  it('「!」始まりの項目を安全アラート要素として描画する', () => {
    render(<NotesCell notes="!減圧前に必ず水中から引き上げる" />);
    const safety = screen.getByTestId('safety-note');
    expect(safety).toBeInTheDocument();
    // 黄色強調のクラスが付与されている（安全ハイライト）
    expect(safety.className).toMatch(/yellow/);
    // 「!」記号は除去され本文が表示される
    expect(safety).toHaveTextContent('減圧前に必ず水中から引き上げる');
    expect(safety.textContent ?? '').not.toContain('!');
  });

  it('複数項目のうち「!」項目だけを安全アラートにする', () => {
    render(<NotesCell notes="通常の確認;!感電に注意;別の通常項目" />);
    const safeties = screen.getAllByTestId('safety-note');
    expect(safeties).toHaveLength(1);
    expect(safeties[0]).toHaveTextContent('感電に注意');
  });

  it('全角「！」始まりも安全アラートにする', () => {
    render(<NotesCell notes="！加圧維持のまま引き上げる" />);
    expect(screen.getByTestId('safety-note')).toBeInTheDocument();
  });

  it('安全項目が無ければ安全アラートを描画しない', () => {
    render(<NotesCell notes="通常の注意のみ" />);
    expect(screen.queryByTestId('safety-note')).toBeNull();
  });
});
