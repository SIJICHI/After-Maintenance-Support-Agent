# Copyright 2026 DataRobot, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Medical device after-maintenance support tools for EVS-X1000 endoscope system."""

from __future__ import annotations

import json
import random
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import numpy as np
import pandas as pd
from langchain_core.tools import tool

DATA_DIR = Path(__file__).parent / "data"

# ディスパッチ（HQエスカレーション）の保存先。プロセス内 dict ＋ JSONファイルで永続化。
# モックアップのため簡易実装。本番では DataRobot 側のデータストア等に置き換える想定。
DISPATCH_FILE = Path(__file__).parent / "dispatch_store.json"


# ---------------------------------------------------------------------------
# Data loading helpers (loaded once per process)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _load_error_codes() -> dict[str, dict]:
    df = pd.read_csv(DATA_DIR / "error_codes.csv", encoding="utf-8-sig")
    return {row["error_code"]: row.to_dict() for _, row in df.iterrows()}


@lru_cache(maxsize=1)
def _load_repair_history() -> pd.DataFrame:
    return pd.read_csv(DATA_DIR / "repair_history.csv", encoding="utf-8-sig")


@lru_cache(maxsize=1)
def _build_knowledge_chunks() -> list[dict]:
    """Split service manual and veteran transcript into paragraph chunks."""
    chunks: list[dict] = []
    for source_file in ["service_manual_excerpt.md", "veteran_interview_transcript.md"]:
        text = (DATA_DIR / source_file).read_text(encoding="utf-8")
        source = source_file.replace(".md", "")
        paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
        for i, para in enumerate(paragraphs):
            chunks.append({"source": source, "chunk_id": f"{source}#{i}", "text": para})
    return chunks


@lru_cache(maxsize=1)
def _build_veteran_chunks() -> list[dict]:
    """Chunks from veteran interview transcript only."""
    text = (DATA_DIR / "veteran_interview_transcript.md").read_text(encoding="utf-8")
    source = "veteran_interview_transcript"
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks = []
    for i, para in enumerate(paragraphs):
        speaker = "田中（ベテランエンジニア）" if "田中：" in para else "インタビュアー"
        chunks.append({"source": source, "chunk_id": f"{source}#{i}", "speaker": speaker, "text": para})
    return chunks


def _char_ngram_similarity(query: str, text: str, n: int = 2) -> float:
    """Character n-gram based cosine similarity (works well for Japanese)."""

    def ngrams(s: str, n: int) -> dict[str, int]:
        s = s.replace(" ", "").replace("\n", "")
        freq: dict[str, int] = {}
        for i in range(len(s) - n + 1):
            g = s[i : i + n]
            freq[g] = freq.get(g, 0) + 1
        return freq

    q_ng = ngrams(query, n)
    t_ng = ngrams(text, n)
    if not q_ng or not t_ng:
        return 0.0
    vocab = set(q_ng) | set(t_ng)
    q_vec = np.array([q_ng.get(g, 0) for g in vocab], dtype=float)
    t_vec = np.array([t_ng.get(g, 0) for g in vocab], dtype=float)
    denom = np.linalg.norm(q_vec) * np.linalg.norm(t_vec)
    return float(np.dot(q_vec, t_vec) / denom) if denom > 0 else 0.0


# ---------------------------------------------------------------------------
# Tool 1: exact_lookup
# ---------------------------------------------------------------------------


@tool
def exact_lookup(
    error_code: Annotated[str, "エラーコード（例: AWS-001, INS-001）"],
) -> str:
    """エラーコード表を完全一致で検索し、症状・推定原因・推奨対応・重要度・典型交換部品を返す。
    エラーコードが判明している場合は最初にこのツールを呼ぶこと。
    エラーコードが不明な場合は semantic_search を使うこと。
    """
    codes = _load_error_codes()
    key = error_code.strip().upper()
    record = codes.get(key)
    if record is None:
        return json.dumps({"error": f"エラーコード '{key}' は見つかりませんでした。"}, ensure_ascii=False)
    result = {
        "error_code": record.get("error_code"),
        "category": record.get("category_name"),
        "symptom": record.get("symptom"),
        "likely_cause": record.get("likely_cause"),
        "recommended_action": record.get("recommended_action"),
        "severity": record.get("severity"),
        "typical_parts_replaced": record.get("typical_parts_replaced"),
        "manual_reference": record.get("manual_reference"),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Tool 2: structured_query
# ---------------------------------------------------------------------------


@tool
def structured_query(
    error_code: Annotated[str, "エラーコードでフィルタ（不要なら空文字列''を渡す）"],
    model: Annotated[str, "機種名でフィルタ（不要なら空文字列''を渡す）"],
    site_name: Annotated[str, "病院・拠点名でフィルタ（不要なら空文字列''を渡す）"],
    date_from: Annotated[str, "開始日 YYYY-MM-DD（不要なら空文字列''を渡す）"],
    date_to: Annotated[str, "終了日 YYYY-MM-DD（不要なら空文字列''を渡す）"],
) -> str:
    """修理履歴DBを条件でフィルタし、類似事例・傾向・推奨部品を返す。
    各条件が空文字列の場合はフィルタしない。最大20件＋集計サマリーを返す。
    """
    df = _load_repair_history().copy()

    if error_code.strip():
        df = df[df["error_code"].str.upper() == error_code.strip().upper()]
    if model.strip():
        df = df[df["model"].str.contains(model.strip(), na=False)]
    if site_name.strip():
        df = df[df["site_name"].str.contains(site_name.strip(), na=False)]
    if date_from.strip():
        df = df[df["date"] >= date_from.strip()]
    if date_to.strip():
        df = df[df["date"] <= date_to.strip()]

    if df.empty:
        return json.dumps({"message": "条件に一致する修理履歴はありませんでした。", "records": []}, ensure_ascii=False)

    summary = {
        "total_records": int(len(df)),
        "first_time_fix_rate": f"{df['first_time_fix'].eq('Y').mean() * 100:.1f}%",
        "avg_resolution_minutes": f"{df['resolution_minutes'].mean():.0f}分",
        "most_common_parts": df["parts_replaced"].value_counts().head(3).index.tolist(),
    }

    records = df.head(20)[
        ["ticket_id", "date", "site_name", "error_code", "symptom",
         "technician_level", "resolution_minutes", "first_time_fix", "parts_replaced", "field_notes"]
    ].to_dict(orient="records")

    return json.dumps({"summary": summary, "records": records}, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Tool 3: semantic_search
# ---------------------------------------------------------------------------


@tool
def semantic_search(
    query: Annotated[str, "検索クエリ（自然文・キーワード。日本語可）"],
) -> str:
    """サービスマニュアルおよびベテランエンジニアの知見ドキュメントを意味検索（RAG）する。
    エラーコードが不明な場合や、対処手順の詳細・背景知識を調べたい場合に使う。上位5件を返す。
    """
    chunks = _build_knowledge_chunks()
    scored = [(c, _char_ngram_similarity(query, c["text"])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:5]
    results = [
        {"source": c["source"], "chunk_id": c["chunk_id"], "score": round(s, 4), "excerpt": c["text"][:300]}
        for c, s in top
        if s > 0
    ]
    if not results:
        return json.dumps({"message": "関連する情報が見つかりませんでした。"}, ensure_ascii=False)
    return json.dumps(results, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Tool 4: voice_search
# ---------------------------------------------------------------------------


@tool
def voice_search(
    query: Annotated[str, "検索クエリ（ベテランエンジニアの暗黙知・コツを検索したい場合に使う）"],
) -> str:
    """ベテランエンジニアの音声インタビュー文字起こしを意味検索する。
    エラーコード表にない暗黙知、現場のコツ、注意点を知りたい場合に特に有効。上位3件を返す。
    注記: 将来的に実際の録音ファイルを追加する場合はASR（音声認識）後に同様の検索を行う想定。
    """
    chunks = _build_veteran_chunks()
    scored = [(c, _char_ngram_similarity(query, c["text"])) for c in chunks]
    scored.sort(key=lambda x: x[1], reverse=True)
    top = scored[:3]
    results = [
        {"speaker": c["speaker"], "chunk_id": c["chunk_id"], "score": round(s, 4), "excerpt": c["text"][:400]}
        for c, s in top
        if s > 0
    ]
    if not results:
        return json.dumps({"message": "関連するベテランの知見が見つかりませんでした。"}, ensure_ascii=False)
    return json.dumps(results, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Tool 5: image_search
# ---------------------------------------------------------------------------

_COMPONENT_MAP: dict[str, str] = {
    "サンプラー": "サンプラー部（検体採取機構）",
    "挿入部": "挿入部",
    "先端部": "先端部",
    "湾曲部": "湾曲部",
    "アングル": "湾曲部・アングル機構",
    "ユニバーサルコード": "ユニバーサルコード",
    "コネクタ": "光源コネクタ部",
    "光源": "光源・LEDモジュール",
    "ビデオプロセッサ": "ビデオプロセッサー",
    "プロセッサ": "ビデオプロセッサー",
    "送水": "送気送水系統",
    "送気": "送気送水系統",
    "吸引": "吸引系統",
    "鉗子": "鉗子チャンネル",
    "防水": "防水構造・リークテスト部位",
    "洗浄": "洗浄消毒接続部（AER接続）",
    "イメージセンサ": "CCDイメージセンサー",
    "ライトガイド": "ライトガイドファイバー",
    "フィルター": "フィルターホイール",
    "モニター": "外部モニター出力",
    "フットスイッチ": "フットスイッチ",
}


@tool
def image_search(
    component_keyword: Annotated[str, "部位名キーワード（例: 送水, 湾曲部, ライトガイド, 防水）"],
) -> str:
    """内視鏡システムの構成図（SVG）から部位名をキーワードで検索し、画像パスと説明を返す。
    対処しようとしている部位の構造を確認したい場合に使う。
    """
    svg_path = str(DATA_DIR / "component_diagram.svg")
    kw = component_keyword.strip()

    matched_component = None
    for key, component in _COMPONENT_MAP.items():
        if key in kw or kw in key:
            matched_component = component
            break

    if matched_component is None:
        best_key = max(_COMPONENT_MAP.keys(), key=lambda k: _char_ngram_similarity(kw, k))
        if _char_ngram_similarity(kw, best_key) > 0.1:
            matched_component = _COMPONENT_MAP[best_key]

    if matched_component is None:
        available = list(_COMPONENT_MAP.values())
        return json.dumps(
            {"message": f"'{kw}' に対応する部位が見つかりませんでした。利用可能な部位: {available[:10]}"},
            ensure_ascii=False,
        )

    result = {
        "component": matched_component,
        "image_path": svg_path,
        "description": (
            f"EVS-X1000 内視鏡システム構成図。'{matched_component}' の位置・構造を確認できます。"
            " 図面はSVG形式で agent/agent/data/component_diagram.svg に格納されています。"
        ),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Tool 6 & 7: HQ escalation / dispatch handoff
# ---------------------------------------------------------------------------

# プロセス内キャッシュ（同一サーバ稼働中は保持される）
_DISPATCH_STORE: dict[str, dict] = {}


def _load_dispatch_store() -> dict[str, dict]:
    """JSONファイルからディスパッチ記録を読み込む（プロセス内 dict にマージ）。"""
    if not _DISPATCH_STORE and DISPATCH_FILE.exists():
        try:
            data = json.loads(DISPATCH_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                _DISPATCH_STORE.update(data)
        except (json.JSONDecodeError, OSError):
            pass
    return _DISPATCH_STORE


def _save_dispatch_store() -> None:
    try:
        DISPATCH_FILE.write_text(
            json.dumps(_DISPATCH_STORE, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        pass


@tool
def create_dispatch_ticket(
    parent_dispatch_id: Annotated[
        str,
        "FSEが現地対応している案件の既存ディスパッチ番号（例: D-20260625-1234）。"
        "1案件＝1ディスパッチ番号で運用され、その配下に相談の子番号を採番する。"
        "FSEが対応中の案件番号が分かっている場合は必ず指定する。不明な場合のみ空文字列''。",
    ],
    summary: Annotated[
        str,
        "FSEとエージェントのやり取りの要約。発生症状・実施した切り分け/作業・確認できた結果・"
        "未解決の論点・現在の困りごとを、RSEがすぐ状況を把握できるよう簡潔にまとめた文章。",
    ],
    error_codes: Annotated[str, "関連するエラーコード（カンマ区切り。なければ空文字列''）"],
    recommended_parts: Annotated[str, "推定される推奨部品（カンマ区切り。なければ空文字列''）"],
    open_questions: Annotated[str, "RSEに引き継ぐ未解決の確認事項・困りごと（なければ空文字列''）"],
) -> str:
    """現場のFSEが切り分け・修理に行き詰まった際、HQのリモートサポートエンジニア（RSE）への
    相談票を発行する。実務では1案件＝1ディスパッチ番号で運用されるため、新しい独立番号は作らず、
    既存の親ディスパッチ番号（parent_dispatch_id）の配下に「子番号」（例: D-...-01）を採番する。
    会話内容を要約して子番号に紐づけて保存し、RSEが get_dispatch_ticket で即座に状況を
    キャッチアップできるようにする。FSEが「HQに相談する」を選んだときに呼ぶこと。
    """
    store = _load_dispatch_store()
    parent = parent_dispatch_id.strip()

    if parent:
        # 既存の親ディスパッチ番号配下に子番号を採番（-01, -02, ...）
        existing_children = [
            t for t in store.values() if t.get("parent_dispatch_id") == parent
        ]
        seq = len(existing_children) + 1
        dispatch_id = f"{parent}-{seq:02d}"
        while dispatch_id in store:
            seq += 1
            dispatch_id = f"{parent}-{seq:02d}"
    else:
        # 親番号が不明な場合のみ、暫定の新規番号を採番（本来はクライアントの管理システムが発番）
        today = datetime.now(timezone.utc).strftime("%Y%m%d")
        parent = f"D-{today}-{random.randint(1000, 9999)}"
        while parent in store:
            parent = f"D-{today}-{random.randint(1000, 9999)}"
        dispatch_id = f"{parent}-01"

    ticket = {
        "dispatch_id": dispatch_id,
        "parent_dispatch_id": parent,
        "type": "rse_consultation",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
        "summary": summary,
        "error_codes": error_codes,
        "recommended_parts": recommended_parts,
        "open_questions": open_questions,
    }
    store[dispatch_id] = ticket
    _save_dispatch_store()
    return json.dumps(
        {
            "dispatch_id": dispatch_id,
            "parent_dispatch_id": parent,
            "status": "open",
            "message": (
                f"案件 {parent} の相談として、子番号 {dispatch_id} を採番しました。"
                f"この番号 {dispatch_id} をHQのリモートサポートエンジニア（RSE）に伝えてください。"
                "RSEはこの番号でこれまでの対応内容を即座に確認できます。"
            ),
        },
        ensure_ascii=False,
        indent=2,
    )


@tool
def get_dispatch_ticket(
    dispatch_id: Annotated[str, "ディスパッチ番号（例: D-20260625-1234）"],
) -> str:
    """ディスパッチ番号に紐づく、FSEとエージェントのこれまでのやり取りの要約を取得する。
    HQのリモートサポートエンジニア（RSE）が、現場から伝えられたディスパッチ番号で
    状況をキャッチアップするために使う。
    """
    store = _load_dispatch_store()
    ticket = store.get(dispatch_id.strip())
    if ticket is None:
        return json.dumps(
            {"error": f"ディスパッチ番号 '{dispatch_id}' は見つかりませんでした。"},
            ensure_ascii=False,
        )
    return json.dumps(ticket, ensure_ascii=False, indent=2)
