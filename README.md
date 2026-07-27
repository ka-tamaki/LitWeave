# LitWeave

LitWeaveは、PDF、書誌情報、読書状態、Markdownメモ、キーワード、引用関係をローカルで管理するWindows向けアプリです。コンセプトは「論文を編み、知識をつなぐ」です。

## 前提環境

- Windows 11 / PowerShell
- Python 3.12
- Node.js 24 / npm 11
- Box Drive（保存対象フォルダーを「常にこのデバイスに保持」に設定）

## セットアップ

PowerShellでプロジェクト直下へ移動し、次を実行します。

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup.ps1
```

## 起動と終了

```powershell
.\scripts\start-litweave.ps1
```

バックエンドとフロントエンドが`127.0.0.1`だけで待ち受け、`http://127.0.0.1:5173`を開きます。ブラウザ起動に失敗した場合もURLを表示します。終了は起動したPowerShellで`Ctrl+C`を押します。ブラウザを自動起動しない場合は`-NoBrowser`を付けます。

初回画面でBox Drive配下のライブラリ保存先を入力します。LitWeaveが表示できるのはBox Driveフォルダーへのローカル保存状態までで、Boxクラウドへの同期完了は保証しません。

## データ保存場所

- 正本: 初回設定で指定したBox Drive配下（`items`、`citations`、`config`、`trash`、`backups`）
- ローカル索引: `%LOCALAPPDATA%\LitWeave\litweave.db`

SQLiteはBox Driveへ保存されず、正本から再構築できます。PDF、JSON、Markdownは一時ファイルを介して確定します。保存先が利用できない場合、別フォルダーへ自動退避せず読み取り専用表示になります。

## テスト

```powershell
.\scripts\test.ps1
```

バックエンドテストはOSの一時フォルダーだけを使用し、実際のBox Driveには書き込みません。個別実行:

```powershell
.\.venv\Scripts\python.exe -m pytest
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

## 主な操作

- ライブラリ: タイトル・著者・キーワードだけを対象に検索し、状態等で絞り込み。行全体から詳細を開き、状態はバッジ表示
- 論文登録: PDFを選択またはドロップし、書誌情報、登録済みキーワードとともに未読登録。処理中はPDF確認／Box Drive保存の段階を表示
- 論文詳細: 書誌編集、状態変更、既定PDFアプリ起動、メモ、引用、ごみ箱移動
- ナレッジグラフ: キーワード／引用グラフ、全体／深さ1～3のローカル表示
- 設定: メモテンプレート、軽量バックアップ、索引再構築、CSV／JSON／Markdown出力

## 既知の制約

- Windowsのネイティブフォルダー選択ダイアログではなく、初回画面へ保存先パスを入力します。
- PDF差し替え、軽量バックアップZIPからの復元、7日ごとの自動バックアップ、完全バックアップは未実装です。
- メモは安全なプレーンテキスト編集で、Markdownプレビューとセクション単位の折りたたみ表示は未実装です。
- グラフは全ノードを表示するため、大規模データではブラウザ性能に依存します。1,000件・5,000件相当の性能試験は未実施です。
- DOI一致・タイトル一致は登録停止ではなく警告する要件ですが、v0.0.1ではPDFハッシュ一致による停止だけを実装しています。
- バックエンドログは`%LOCALAPPDATA%\LitWeave\logs\litweave.log`へ保存し、30世代を保持します。PDF本文、メモ本文、検索語、元PDFのパスは記録しません。
- Box Driveのクラウド同期状態、外部エディタとの競合は検出しません。
- PDFの先頭読取が15秒を超えた場合はタイムアウトし、ローカルコピーからの再選択を案内します。
