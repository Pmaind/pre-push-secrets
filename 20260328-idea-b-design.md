---
date: 2026-03-28
type: design
tags:
  - idea-b
  - git-hook
  - secrets-detection
  - mvp
related: 20260328-critique-final.md
---

# Idea-B 設計書：pre-push secrets 検出フック

## スコープ
- git push 前に secrets を検出して警告する
- ブロックはしない（警告のみ）
- secrets 検出のみ（公開設定・ライセンスは対象外）

---

# 1. ユーザーフロー

## インストール
```bash
npx push-sentinel install
```
→ `.git/hooks/pre-push` に自動登録

---

## 通常の push（問題なし）
```bash
git push
# → スキャン実行
# → [✓] No secrets detected.
# → push 続行
```

---

## 警告ありの push
```bash
git push
# → スキャン実行
# → [!] Potential secrets detected:
#
#     src/config.ts:12
#     OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
#
#     .env:3
#     AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxx
#
# → Push continues. Review the above before sharing.
```

---

# 2. 仕様

## 2.1 検出対象
push 直前のステージ済み差分（`git diff --cached`）のみを対象とする。
リポジトリ全体は走査しない。

`git diff HEAD origin/HEAD` は `origin/HEAD` が存在しない場合（初回push / fork / detached HEAD）に失敗するため使用しない。

## 2.2 検出パターン・severity（MVP）

severity は HIGH / MEDIUM / LOW の3段階。

| カテゴリ | パターン例 | severity | 危険性 |
|---|---|---|---|
| Private Key | `-----BEGIN (RSA\|EC\|OPENSSH) PRIVATE KEY-----` | HIGH | サーバー・証明書の完全乗っ取り |
| AWS Access Key | `AKIA[0-9A-Z]{16}` | HIGH | クラウドリソースの無制限操作・課金 |
| AWS Secret Key | `[a-z0-9/+=]{40}`（キー名セットで判定） | HIGH | 同上 |
| GitHub Token | `ghp_[a-zA-Z0-9]{36}` / `github_pat_` | HIGH | リポジトリの読み書き・削除 |
| OpenAI API Key | `sk-[a-zA-Z0-9]{32,}` | MEDIUM | 無制限の課金・データ漏洩 |
| Anthropic API Key | `sk-ant-[a-zA-Z0-9\-]{32,}` | MEDIUM | 同上 |
| Generic API Key | `[Aa][Pp][Ii]_?[Kk][Ee][Yy]\s*=\s*["']?[^\s"']{16,}` | LOW | サービス依存 |
| .env ファイル | `.env` がステージされている場合 | MEDIUM | 複数secretの一括漏洩 |

## 2.3 誤検出（false positive）対策

**方針：検出精度より誤検出削減を優先する。**
ノイズが多いとユーザーが無視するようになり、ツールの価値がゼロになる。

### フィルタルール

**① 変数名フィルタ**
`(API|SECRET|TOKEN|KEY|PASSWORD)` を含む行のみ対象とする。

**② 高entropy条件（Shannon entropy）**
Shannon entropy を計算し、閾値以上の文字列のみ対象とする。

```
H = -Σ p(c) * log2(p(c))
```

- 閾値：`H >= 3.5`（実測調整予定）
- 対象：16文字以上の英数字列
- 除外：連続する同一文字（`aaaa...`）、辞書単語の連結

**entropy目安**
| 文字列例 | entropy | 判定 |
|---|---|---|
| `password123` | 2.8 | 除外 |
| `sk-proj-aBcDeFgH...` | 4.2 | 検出 |
| `AKIAIOSFODNN7EXAMPLE` | 3.9 | 検出 |

**③ .env は無条件警告**
`.env` がステージされている場合は内容に関わらず警告。

### 除外ルール
- `.gitignore` に含まれるファイル
- テストファイル内のダミー値（`test_` / `fake_` / `example_` プレフィックス）
- `.push-sentinel-ignore` に記載されたパターン

## 2.4 ignore UX

**目標：誤検出を1コマンドで除外できる。操作を覚えなくてもいい。**

### 警告時の表示
```
[push-sentinel] ⚠ Potential secrets found:

  [HIGH] src/config.ts:12
  OPENAI_API_KEY=sk-proj-xxxxxx...
  → Risk: Unauthorized billing / data access
  → To ignore this line: push-sentinel ignore src/config.ts:12
  → To ignore this pattern: push-sentinel ignore --pattern OPENAI_API_KEY

  Push continues.
```

### ignoreコマンド
```bash
# 特定行を除外
push-sentinel ignore src/config.ts:12

# パターンを除外
push-sentinel ignore --pattern OPENAI_API_KEY

# 除外一覧を確認
push-sentinel ignore --list

# 除外を削除
push-sentinel ignore --remove OPENAI_API_KEY
```

### .push-sentinel-ignore の形式
```
# ファイルパス（glob対応）
src/config.ts:12
tests/**

# パターン名
OPENAI_API_KEY
DUMMY_SECRET
```

- ファイルはリポジトリルートに自動生成
- `.gitignore` に追加するかはユーザーが判断（自動追加しない）

---

# 3. ファイル構成

```
push-sentinel/
├── package.json
├── bin/
│   └── cli.js          # npx エントリーポイント
├── src/
│   ├── install.js      # hookインストール処理
│   ├── scan.js         # diff取得 + パターンマッチ
│   ├── patterns.js     # 検出パターン定義
│   └── reporter.js     # 出力フォーマット
└── hook-template.sh    # .git/hooks/pre-push に書き込むテンプレート
```

---

# 4. 各モジュール仕様

## 4.1 `bin/cli.js`
```
npx push-sentinel install   → hookインストール
npx push-sentinel scan      → 手動スキャン（テスト用）
npx push-sentinel uninstall → hook削除
```

## 4.2 `src/install.js`
既存フックとの衝突を避けるため、**ラッパー方式**を採用する。

既存の `pre-push` は `.git/hooks/pre-push.local` にリネームして保持し、
push-sentinel がラッパーとして呼び出す。

```sh
#!/bin/sh

npx push-sentinel scan

if [ -f .git/hooks/pre-push.local ]; then
  .git/hooks/pre-push.local
fi
```

- 冪等性を保証（2回実行しても重複しない）
- アンインストール時は `pre-push.local` を `pre-push` に戻す

## 4.3 `src/scan.js`
```
1. git diff --cached で差分テキスト取得
2. 追加行（+ で始まる行）のみを対象にパターンマッチ
3. 変数名フィルタ・高entropy条件を適用
4. マッチ結果をファイル名・行番号・マッチ内容で返す
```

## 4.4 `src/reporter.js`
- 検出なし：1行で終わる（邪魔しない）
- 検出あり：ファイル名・行番号・該当文字列（後半マスク）を表示
- 終了コードは常に 0（ブロックしない）

---

# 5. 出力仕様

## 検出なし
```
[push-sentinel] ✓ No secrets detected.
```

## 検出あり
```
[push-sentinel] ⚠ Potential secrets found:

  [HIGH] src/config.ts:12
  AWS_ACCESS_KEY=AKIAIOSFODNN7xxxxxxxx...
  → Risk: Full access to AWS resources. Attacker can create/delete
           instances, incur charges, or exfiltrate data.
  → To ignore: push-sentinel ignore src/config.ts:12

  [MEDIUM] .env:3
  OPENAI_API_KEY=sk-proj-xxxxxx...
  → Risk: Unauthorized API usage billed to your account.
  → To ignore: push-sentinel ignore .env:3

  Push continues. Double-check before sharing.
```

- severity（HIGH / MEDIUM / LOW）を先頭に表示
- 危険性を1〜2行で説明（技術用語を避ける）
- ignore コマンドを毎回提示（覚えなくていい設計）
- マッチ文字列は末尾 50% をマスク
- 最大表示件数：10件（超えた場合は「+ N more」）

---

# 6. package.json（主要項目）

```json
{
  "name": "push-sentinel",
  "version": "0.1.0",
  "bin": {
    "push-sentinel": "./bin/cli.js"
  },
  "engines": {
    "node": ">=16"
  },
  "dependencies": {}
}
```

依存ゼロ（Node.js 標準モジュールのみ）

---

# 7. README（1行価値説明）

```
push-sentinel: Warns you if secrets are in your git diff before push.
```

---

# 8. MVP スコープ（作る / 作らない）

## 作る
- [x] `npx push-sentinel install` でフック登録
- [x] push 前に diff をスキャン
- [x] 上記8パターンの検出
- [x] 警告表示（ブロックなし）
- [x] `.push-sentinel-ignore` による除外

## 作らない（v1以降）
- [ ] 設定ファイル（カスタムパターン）
- [ ] CI 統合
- [ ] Web UI
- [ ] 課金機能
- [ ] Monorepo対応

---

# 9. 実装順序

```
1. patterns.js  → パターン定義（30分）
2. scan.js      → diff取得 + マッチ（1時間）
3. reporter.js  → 出力フォーマット（30分）
4. install.js   → hook登録（30分）
5. cli.js       → エントリーポイント（30分）
6. 手動テスト   → 実際のrepoで確認（1時間）
7. README       → 1行説明 + インストール手順（30分）
```

合計目安：**5時間以内**

---

# 10. 検証マイルストーン

| タイミング | 確認指標 | 判断 |
|---|---|---|
| Day3 | npm DL 10以上 / Star 20以上 | 継続 |
| Day7 | 継続DL / Issue起票あり | 有望 |
| Day14 | WAU確認 / アンインストール率 | 続けるか判断 |

Star 単体では判断しない。npm DL と Issue の有無を優先。
