# g2_helloworld

**Even Realities G2 スマートグラスのサイドロードアプリデモ**

... および WebSocket デモ。

**作者:** gpsnmeajp  
**ライセンス:** Unlicense

デモ（QRコードですぐにサイドロードできます）: https://sabowl.sakura.ne.jp/g2/helloworld/

参考: https://zenn.dev/gpsnmeajp/scraps/beb45043a2d731

![スクリーンショット](image.png)

---

## 目的

- G2 グラス向け**動作確認済みデモアプリ**
- 任意の Web サーバーにデプロイできる**サイドロードアプリのサンプル**
- Even Hub SDK を使い始めるための**初心者向けサンプル**
- 動作確認に使える**任意テキストの素早い表示手段**

---

## 機能

- **自動生成 QR コード** — 自分自身の URL を QR コードとして表示。Even Hub コンパニオンアプリでスキャンすれば即座にサイドロード可能
- **テキスト送信** — Web UI から G2 ディスプレイに任意のテキストを送信（最短 2 秒間隔でスロットリング）
- **最後の入力の復元** — 最後に送信したテキストを SDK ストレージに保存し、次回起動時に自動表示
- **自動クリアタイマー** — 指定秒数後にグラスのディスプレイをスペースで上書きするオプション。送信のたびにタイマーがリセット。秒数は SDK ストレージに保存され、次回起動時に復元
- **WebSocket クライアント** — WebSocket サーバーに接続してリモートからテキストをプッシュしたり、G2 の入力イベントを JSON として受信。URL は SDK ストレージに保存され次回起動時に自動接続。失敗時はエクスポネンシャルバックオフで再接続
- **入力イベントビジュアライザー** — タップ・ダブルタップ・スクロールアップ/ダウン・異常終了・システム終了イベントをリアルタイムで Web UI に表示
- **WebView 内コンソール** — `console.log` / `.warn` / `.error` の出力をキャプチャしてブラウザパネルに表示。デバイス上でのデバッグに便利
- **ストレージ操作** — **Clear Storage** ボタンで SDK ストレージの保存済みテキストを削除；**Reload** ボタンでページを再読み込み

---

## 必要要件

- [Even Realities G2 スマートグラス](https://www.evenrealities.com/)
- Even アプリ（iOS / Android）
- [Even Hub **開発者アカウント**](https://hub.evenrealities.com/)
- Node.js 18 以上
- PC とグラスが**同じ Wi-Fi ネットワーク**に接続されていること(ローカル動作の場合)

---

## セットアップ

```bash
npm install
```

---

## 開発

```bash
npm run dev
```

Vite が `http://localhost:5173`（または次の空きポート）でサーバーを起動します。

ブラウザで `http://<LAN の IP>:5173` を開いて QR コードを確認し、Even Hub アプリでスキャンしてサイドロードしてください。

---

## ビルド

```bash
npm run build
```

`dist/` に出力されます。任意の静的 Web サーバーにデプロイしてください。

ベース URL の設定は package.json で行います。

`"build": "tsc && vite build --base=/g2/helloworld/",`

---

## サイドロード手順

1. Even Hub で開発者アカウントを登録
2. Even Hub アプリを開く → 右上アイコンをタップ → **My plugin** → 自分の名前をタップ → **Prototype mode** を有効化
3. `npm run dev` を実行
4. ブラウザで `http://<LAN の IP>:5173` を開く
5. 表示された QR コードを Even Hub アプリでスキャン

---

## 使い方

| 操作 | 結果 |
|---|---|
| テキストエリアに入力 → **Ctrl+Enter** | G2 ディスプレイにテキストを送信 |
| **Enter** | テキストエリアで改行 |
| 秒数を入力 → **Set**（自動クリア） | 指定秒後にグラスのディスプレイをスペースで上書き |
| **Clear**（自動クリア） | 自動クリアタイマーを無効化 |
| `ws://` URL を入力 → **Connect** | WebSocket サーバーに接続してリモートテキストプッシュとイベント転送を開始 |
| **Disconnect** | WebSocket サーバーから切断 |
| **Clear URL**（WebSocket） | 切断して SDK ストレージから保存済み URL を削除 |
| グラスのタッチパッドを操作 | イベントモニターにリアルタイム表示 |
| **Clear Storage** ボタン | SDK ストレージの保存済みテキストを削除 |
| **Reload** ボタン | ページを再読み込み |

---

## WebSocket API

| 方向 | フォーマット | 説明 |
|---|---|---|
| サーバー → クライアント | プレーンテキストフレーム | グラスに表示されてテキストエリアにも反映。手動送信と同様の 2 秒スロットリングが適用 |
| クライアント → サーバー | JSON | 接続時に送信: `{"type":"connect","timestamp":1234567890}` |
| クライアント → サーバー | JSON | G2 入力イベント: `{"type":"glasses-input","event":"tap","timestamp":1234567890}` |

イベント名: `tap`, `double-tap`, `scroll-up`, `scroll-down`, `abnormal-exit`, `system-exit`

### WebSocket 接続の制限

| デプロイ方法 | 制限 |
|---|---|
| **QR コードによるサイドロード**（`npm run dev` / 静的サーバー） | 制限なし — 任意の `ws://` または `wss://` URL が使用可能 |
| **Even Hub へのアップロード** | 接続先は (a) `localhost`（デバイス内）または (b) `app.json` で宣言されたドメインのいずれかのみ |

Even Hub に公開する際は、以下の例のように `app.json` に許可ドメインを追加してください。  
ドメインは**完全一致**が必要です（ワイルドカード不可）。

> **注意:** `permissions` 配列に対象ドメインが含まれていない場合、Even Hub によって WebSocket 接続は実行時に無音でブロックされます。

---

## WebSocket サーバー（`ws/`）

G2 グラスとブラウザベースのダッシュボードを仲介する軽量 Python WebSocket サーバーです。

### 必要要件

- Python 3.10 以上
- `pip install -r ws/requirements.txt`（`websockets >= 12.0`）

### 起動

```bash
cd ws
pip install -r requirements.txt
python server.py
```

| エンドポイント | アドレス | 説明 |
|---|---|---|
| WebSocket | `ws://0.0.0.0:8765` | G2 グラスとダッシュボードが接続 |
| HTTP / ダッシュボード UI | `http://0.0.0.0:8080/index.html` | ブラウザで開く |

### サーバープロトコル

| 方向 | フォーマット | 説明 |
|---|---|---|
| グラス → サーバー | JSON | `{"type":"connect","timestamp":1234567890}` — WebSocket 接続時に送信。グラスとして登録 |
| グラス → サーバー | JSON | `{"type":"glasses-input","event":"tap","timestamp":1234567890}` — タッチパッド・ライフサイクルイベント |
| サーバー → グラス | プレーンテキスト | グラスのディスプレイに表示 |
| ダッシュボード → サーバー | JSON | `{"type":"register"}` — ダッシュボードとして登録 |
| ダッシュボード → サーバー | JSON | `{"type":"send-text","text":"Hello"}` — すべてのグラスにテキストをプッシュ |
| サーバー → ダッシュボード | JSON | glasses-input イベントをそのまま転送 |
| サーバー → ダッシュボード | JSON | `{"type":"status","glasses":1,"dashboards":1}` — リアルタイム接続数 |
| サーバー → ダッシュボード | JSON | `{"type":"send-ack","text":"Hello","sent_to":1}` — 配信確認 |

### ダッシュボード UI の機能

- Python サーバーへの接続・切断
- 接続中のグラスとダッシュボードのライブカウンター
- 接続中の全グラスへの任意テキスト送信（Ctrl+Enter ショートカット）
- 最後に送信したテキストのグラス表示プレビュー
- グラス入力イベントのリアルタイムログ（tap、double-tap、scroll-up、scroll-down など）

---

## プロジェクト構造

```
g2_helloworld/
  app.json          Even Hub アプリマニフェスト
  index.html        QR コード・テキスト送信・イベントモニター UI
  src/
    main.ts         Even Hub SDK 連携とグラス側ロジック
  ws/
    server.py       Python WebSocket + HTTP サーバー
    index.html      ダッシュボード UI（server.py が配信）
    requirements.txt
  package.json
  tsconfig.json
```

---

## 技術スタック

- [Vite](https://vite.dev/) + TypeScript
- [@evenrealities/even_hub_sdk](https://www.npmjs.com/package/@evenrealities/even_hub_sdk)
- [@evenrealities/evenhub-cli](https://www.npmjs.com/package/@evenrealities/evenhub-cli)
- [@evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator)
- Python + [websockets](https://websockets.readthedocs.io/)（サーバーのみ）
