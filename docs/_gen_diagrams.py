"""設計レビュー資料(Word用)の図をmatplotlibで生成する。日本語は Hiragino Sans。"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

plt.rcParams["font.family"] = "Hiragino Sans"
plt.rcParams["axes.unicode_minus"] = False

OUT = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT, exist_ok=True)

GREEN = "#1f6f54"
TEAL = "#2a8a6a"
BLUE = "#3366cc"
AMBER = "#c8932a"
GRAY = "#3a4252"
LIGHT = "#eef3f1"


def box(ax, xy, w, h, text, fc=GRAY, tc="white", fs=11, rounded=0.02):
    x, y = xy
    p = FancyBboxPatch(
        (x, y), w, h, boxstyle=f"round,pad=0.02,rounding_size={rounded}",
        linewidth=1.2, edgecolor="#222", facecolor=fc, mutation_aspect=1,
    )
    ax.add_patch(p)
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center",
            color=tc, fontsize=fs, wrap=True)


def arrow(ax, p1, p2, text=None, color="#444"):
    a = FancyArrowPatch(p1, p2, arrowstyle="-|>", mutation_scale=14,
                        linewidth=1.4, color=color, shrinkA=2, shrinkB=2)
    ax.add_patch(a)
    if text:
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        ax.text(mx + 0.06, my, text, ha="left", va="center", fontsize=9, color="#333")


def new_ax(w=9, h=11):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 12)
    ax.axis("off")
    return fig, ax


def save(fig, name):
    fig.savefig(os.path.join(OUT, name), dpi=150, bbox_inches="tight",
                facecolor="white")
    plt.close(fig)


# 1. 全体ライフサイクル（縦フロー）
def diagram_lifecycle():
    fig, ax = new_ax(8, 12)
    steps = [
        ("お客様の緊急コール", GRAY),
        ("コールセンター\nディスパッチ番号 発番／顧客・契約確認", GREEN),
        ("RSE 局面①：顧客電話トリアージ", TEAL),
        ("FSE 派遣判断\n最寄り営業所の出動可能FSEを提示", BLUE),
        ("派遣ブリーフィング\nRSEが編集 → リリース", GREEN),
        ("FSE 現地対応\n引き継ぎ受領 → 切り分け → 修理", TEAL),
        ("（行き詰まり時）RSE 局面②：技術支援＝子番号で相談", BLUE),
        ("SR報告書ドラフト\n編集 → Word出力", GREEN),
        ("案件クローズ", GRAY),
    ]
    y = 11.0
    h = 0.9
    w = 8.2
    x = 0.9
    centers = []
    for txt, fc in steps:
        box(ax, (x, y), w, h, txt, fc=fc, fs=11)
        centers.append((x + w / 2, y))
        y -= 1.25
    for i in range(len(centers) - 1):
        top = (centers[i][0], centers[i][1])
        bot = (centers[i + 1][0], centers[i + 1][1] + h)
        arrow(ax, top, bot)
    save(fig, "01_lifecycle.png")


# 2. RSE局面①
def diagram_rse1():
    fig, ax = new_ax(8.5, 12)
    nodes = [
        ("コールセンターから転送", GRAY),
        ("施設名を確認", GRAY),
        ("customer_lookup\n使用製品・保守契約を照会", BLUE),
        ("保守契約なし → 有償の口頭確認\n（同意項目をヒアリングに必須化）", AMBER),
        ("ヒアリング表 [[hearing]]\n標準テンプレ／既知情報は除外", TEAL),
        ("お客様と電話しながら結果記入", GRAY),
        ("トリアージ表 [[triage]]\n推定原因・類似事例・推奨部品・方針", TEAL),
        ("電話で解決？ → クローズ／派遣判断", GRAY),
        ("find_available_fse\n最寄り営業所の出動可能FSEを提示", BLUE),
        ("派遣ブリーフィング [[dispatch_briefing]]\nRSEが編集 → FSEにリリース", GREEN),
    ]
    y = 11.2
    h = 0.85
    w = 8.4
    x = 0.8
    centers = []
    for txt, fc in nodes:
        box(ax, (x, y), w, h, txt, fc=fc, fs=10.5)
        centers.append((x + w / 2, y))
        y -= 1.12
    for i in range(len(centers) - 1):
        arrow(ax, centers[i], (centers[i + 1][0], centers[i + 1][1] + h))
    save(fig, "02_rse_phase1.png")


# 3. FSE現地フロー
def diagram_fse():
    fig, ax = new_ax(8.5, 12)
    nodes = [
        ("FSE 現場到着\nディスパッチ番号で対応開始", GRAY),
        ("get_dispatch_ticket\n引き継ぎ受領・要約提示", BLUE),
        ("作業チェックリスト [[steps]]\n重点指示を起点に展開", TEAL),
        ("現地で実施・チェック\n安全注意は ⚠️ 黄色で強調", AMBER),
        ("結果確認の分岐 [[choices]]", GRAY),
        ("原因確定？ → 未確定なら次の作業手順へ戻る", GRAY),
        ("暫定結論＝原因切り分け [[triage]]", TEAL),
        ("修理・最終確認・完了判定", GRAY),
        ("SR報告書ドラフト [[report]]\nですます調・有償部品明示", GREEN),
        ("編集 → Wordでダウンロード", GREEN),
    ]
    y = 11.2
    h = 0.85
    w = 8.4
    x = 0.8
    centers = []
    for txt, fc in nodes:
        box(ax, (x, y), w, h, txt, fc=fc, fs=10.5)
        centers.append((x + w / 2, y))
        y -= 1.12
    for i in range(len(centers) - 1):
        arrow(ax, centers[i], (centers[i + 1][0], centers[i + 1][1] + h))
    # ループ矢印（分岐→次手順→分岐）
    save(fig, "03_fse_flow.png")


# 4. ディスパッチ番号の串刺し
def diagram_dispatch():
    fig, ax = new_ax(9, 7)
    ax.set_ylim(0, 8)
    box(ax, (3.3, 6.6), 3.4, 1.0,
        "親ディスパッチ番号\nD-20260626-7765\n（コールセンター発番）", fc=GREEN, fs=10.5)
    children = [
        ("RSE 受電トリアージ", TEAL, 0.4),
        ("派遣ブリーフィング", GREEN, 2.6),
        ("FSE 現地対応・報告書", TEAL, 4.8),
        ("子番号 -01\nFSE→RSE相談1", BLUE, 7.0),
    ]
    for txt, fc, x in children:
        box(ax, (x, 3.6), 2.0, 1.1, txt, fc=fc, fs=9.5)
        arrow(ax, (5.0, 6.6), (x + 1.0, 4.7))
    ax.text(5.0, 2.7, "ヒアリング・トリアージ・ブリーフィング・作業履歴・報告書は\nすべて同一番号の配下に保存（後日トラック可／交代要員も引き継ぎ可）",
            ha="center", va="center", fontsize=10, color="#333")
    save(fig, "04_dispatch.png")


# 5. データ構成
def diagram_data():
    fig, ax = new_ax(9, 7.5)
    ax.set_ylim(0, 8)
    ax.text(2.6, 7.6, "知識ベース（RAG/検索）", ha="center", fontsize=12, color=GREEN, weight="bold")
    kb = ["error_codes.csv\nエラーコード表", "repair_history.csv\n修理履歴DB",
          "service_manual_excerpt.md\nマニュアル", "veteran_interview...md\nベテラン知見",
          "component_diagram.svg\n構成図", "hearing_templates.json\n標準ヒアリング"]
    for i, t in enumerate(kb):
        box(ax, (0.4, 6.3 - i * 1.0), 4.2, 0.8, t, fc=TEAL, fs=9.5)
    ax.text(7.4, 7.6, "マスタ／業務データ", ha="center", fontsize=12, color=GREEN, weight="bold")
    md = ["customer_master.json\n顧客（製品・保守契約・最寄り営業所）",
          "employee_master.json\n従業員（RSE20/FSE100・所属・対応可否）",
          "dispatch_store.json\nディスパッチ記録（実行時生成）"]
    for i, t in enumerate(md):
        box(ax, (5.3, 6.3 - i * 1.3), 4.3, 1.0, t, fc=GRAY, fs=9.5)
    save(fig, "05_data.png")


# 6. ツールマップ
def diagram_tools():
    fig, ax = new_ax(9.5, 9)
    ax.set_ylim(0, 10)
    box(ax, (3.6, 8.6), 3.0, 1.0, "LangGraph エージェント\nMyAgent", fc=GREEN, fs=11)
    groups = {
        "知識検索": (0.3, ["exact_lookup", "structured_query", "semantic_search",
                         "voice_search", "image_search", "hearing_template"], TEAL),
        "マスタ照会": (3.6, ["customer_lookup", "employee_lookup", "find_available_fse"], BLUE),
        "案件・引き継ぎ": (6.9, ["create_dispatch_ticket", "get_dispatch_ticket",
                            "save_hearing_results", "release_action_plan",
                            "release_dispatch_briefing"], GRAY),
    }
    for title, (x, items, fc) in groups.items():
        ax.text(x + 1.4, 7.4, title, ha="center", fontsize=11, color=fc, weight="bold")
        for i, it in enumerate(items):
            box(ax, (x, 6.6 - i * 0.95), 2.8, 0.7, it, fc=fc, fs=9)
        arrow(ax, (5.1, 8.6), (x + 1.4, 6.95))
    save(fig, "06_tools.png")


if __name__ == "__main__":
    diagram_lifecycle()
    diagram_rse1()
    diagram_fse()
    diagram_dispatch()
    diagram_data()
    diagram_tools()
    print("diagrams generated in", OUT)
