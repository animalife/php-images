# php-images

docker-library/php と FrankenPHP を、上流と同じ手順でこのリポジトリでビルドして GHCR に公開する。

PHP のセキュリティリリースの夜に、上流の FrankenPHP イメージ（`dunglas/frankenphp`）を待たずに、
php.net での公開からそのままパッチ入りのイメージを作るためのリポジトリ。中身は上流のビルド手順だけで、秘密は持たない。

## イメージ

| イメージ | タグ | 例 |
|---|---|---|
| `ghcr.io/animalife/php-images/php` | `<PHP 版>-<variant>-<os>`、追うタグと同名の移動タグ | `8.6.0-cli-trixie`, `8.6-cli-trixie` |
| `ghcr.io/animalife/php-images/frankenphp` | `<FrankenPHP 版>-php<PHP 版>-<os>`、移動タグ `php<minor>-<os>` | `1.14.0-php8.6.0-trixie`, `php8.6-trixie` |

- linux/amd64 と linux/arm64 のマルチアーキ。FrankenPHP は上流の `runner` ターゲットだけをビルドする
- 各アーキの container-structure-test（`tests/`）と版の一致を検査してからタグを付ける
- 公開した index には GitHub の artifact attestation（SLSA build provenance）を付ける。消費側が固定している digest で確かめる

  ```sh
  gh attestation verify oci://ghcr.io/animalife/php-images/frankenphp@sha256:<index の digest> \
    --repo animalife/php-images \
    --signer-workflow animalife/php-images/.github/workflows/build.yml \
    --source-ref refs/heads/main \
    --deny-self-hosted-runners
  ```

  attestation はマルチアーキの index の digest にだけ付く。アーキごとの manifest の digest を渡すと verify は失敗する。
  消費側はこの検証（`--source-ref refs/heads/main` と `--signer-workflow`）を必ず通す前提にする。これで確かめられるのは
  「main の build.yml が作った」ことまでで、main の中身は書き込み権限者（collaborator）を信頼している。PR のレビューは
  必須にしていないので、書き込み権限者は PR で ci.yml や build.yml そのものを書き換えてマージできる。
  environment `ghcr-publish` も誤操作のガードで、書き込み権限者がブランチ上で外せば GHCR には書ける。
  将来レビューを必須にするなら、夜のジョブの App のトークン（pull-requests: write）が承認の抜け道にならないか（App が
  PR を作り、同じ App や別の経路で承認できないか）を合わせて確かめる

- 固定タグも、同じ版のまま作り直すと指す先が変わる。親イメージ（`baseImages`）や上流の Dockerfile の更新、
  ビルドの入力の変更で再ビルドすると、同じ `8.6.0-cli-trixie` / `1.14.0-php8.6.0-trixie` が新しい digest を指す。
  内容を固定したいときは digest で参照する
- 公開するのは main の push の run（と、復旧用の版を指定しない workflow_dispatch）だけ。ビルドする PHP の版は常に
  `versions.json` の pin で、run は commit 順に直列で走る（build.yml の concurrency）。
  - この run の `versions.json` と main の先端の `versions.json` が、そのイメージに関わる pin（php では `baseImages.php` と
    その版の設定（`officialDigest` を含む）、FrankenPHP ではそれに `baseImages.frankenphp` と `frankenphp` を足したもの）で
    一致しないか、この run の commit から main の先端までにビルドの入力（build.yml・composite action・scripts・tests・
    `.github/aqua.yaml`・`.node-version`）が変わっていれば、タグを付けずに成功で終える（main の先の commit の run が組み直す）。
    再実行（Re-run）した run なら失敗にする（古いアーカイブで新しい run の中身を上書きしないように）。
    再実行した run は、pin とビルドの入力が同じでも、run の commit が main の先端でなければ失敗にする（最大 3 日前の
    アーカイブで、apt のパッケージなどが後退しうるため）。
    php をこの理由でタグなしにした版は、FrankenPHP もその版は組まない（失敗にはしない）。
    後続の run は main への push で起きることを前提にしている。`[skip ci]` などでワークフローが起きない push だと
    組み直されないので、そのときは版を指定しない workflow_dispatch で全部ビルドし直す
  - それ以外は、固定タグと移動タグを付ける（`scripts/lib/publish.mjs`）
- `staging-*` タグは attestation を付ける前の一時置き場で、使わない

## 設定: versions.json

ビルドする版は `versions.json` の 1 ファイルで決まる。

- `php.<minor>`: ビルドする PHP の版を、パッチ付きの公式 `php` イメージのタグ（`officialTag`、例 `8.6.0-cli-trixie`）で持つ。
  FrankenPHP は ZTS の PHP を前提にするので、8.6 以上は `cli`、8.5 以下は `zts`（上流の docker-bake.hcl の
  `php_base_variant` と同じ。食い違うとビルドが止まる）。`officialDigest` はそのタグの公式イメージの digest。
  - `officialDigest` はビルドのきっかけで、内容は固定しない。ビルドする Dockerfile はビルドした時点の `library/php` から取る:
    パッチ付きのタグがあればその `GitCommit` / `Directory`、無ければ（official がまだ追いついていない、またはすでに先へ進んで
    パッチ付きのタグが消えた）移動タグ（`8.6-cli-trixie`）のものを取り、php.net の情報で `PHP_VERSION` / `PHP_URL`・`PHP_ASC_URL` /
    `PHP_SHA256` だけを pin の版に差し替える（上げる方向にも下げる方向にも）。`GPG_KEYS` と `.asc` の署名検証は上流のまま残す。
    取った Dockerfile の `PHP_VERSION` が pin と一致しなければ止まる
  - `officialDigest` は `null` でもよい。夜のジョブが版だけを上げたとき（公式イメージがまだ無い）にこうなる。
    公式イメージが出たら Renovate が digest を埋める PR（pinDigest）を作る。CI とビルドは上の取り方で `null` のまま通る
- `frankenphp`: 上流のタグと commit。Renovate が両方を同時に更新し、ビルドはタグが commit を指しているかを確かめる
- `baseImages`: 上流の Dockerfile がタグだけで参照する親イメージ（docker-library/php の `FROM debian:trixie-slim`、
  FrankenPHP の bake の `golang-base` や `# syntax=docker/dockerfile:1` など）の digest。`php` と `frankenphp` に分けて持つ。
  上流の Dockerfile は書き換えず、名前付きコンテキスト（`--build-context` / bake の `contexts`）と `BUILDKIT_SYNTAX` で差し替える。
  取得した Dockerfile や bake の定義が pin の無いイメージを参照していたらビルドを止める（上流が親イメージを変えたら、ここに足して直す）。
  Renovate が digest だけを更新する
- `platforms`: プラットフォームとランナー。組は `linux/amd64` = `ubuntu-24.04`、`linux/arm64` = `ubuntu-24.04-arm` だけを受け付ける
  （存在しないラベルで公開のキューが詰まらないように）。上げるときは `scripts/lib/plan.mjs` の許可リストとワークフローの
  `runs-on` も手で揃える（Renovate はランナーのメジャー更新を提案しない）

### digest 固定が及ばない入力

上流の Dockerfile は書き換えないので、次はビルドのたびにその時点のものを取る。同じ pin でも中身が変わりうる。

- FrankenPHP の Dockerfile が取る `install-php-extensions`（mlocati/docker-php-extension-installer の `releases/latest`、checksum の検査なし）
- FrankenPHP の Dockerfile が取る e-dant/watcher（GitHub の `releases/latest` の tarball、checksum の検査なし）
- どちらの Dockerfile も行う `apt-get update` / `apt-get install` の Debian パッケージ
- 上のものはアーキごとのジョブがそれぞれ別の時刻に取るので、1 つの index の中でも amd64 と arm64 で中身が食い違うことがある
- php のソース（php.net の tarball）は版と `PHP_SHA256` で固定され、`.asc` の署名も検査される。Go のモジュールは上流の `go.sum` で検査される

### 版を足す

`php` に項目を足すだけでよい。例えば 8.5 なら:

```json
"8.5": {
  "os": "trixie",
  "officialTag": "8.5.13-zts-trixie",
  "officialDigest": "sha256:<docker buildx imagetools inspect php:8.5.13-zts-trixie の digest>"
}
```

## ビルドの経路

ワークフローは `.github/workflows/build.yml` の 1 本で、php → FrankenPHP を同じ run の中でつなぐ。

### 普段: Renovate の更新 PR のマージ

Renovate が `versions.json` を更新する PR は次の 2 種類で、どちらも即時に自動マージする（冷却は消費側で行う）。

- 版の更新: 公式イメージにパッチ版が出ると `officialTag` を `8.6.0-cli-trixie` → `8.6.1-cli-trixie` に上げ、digest も入れる（minor ごとに別の PR）
- digest の更新: 同じ版の公式イメージが作り直されると `officialDigest` だけを更新する（debian の更新など）。`null` を埋める pinDigest も同じ扱い

main への push で、差分のあった版の php をビルドし、続けて FrankenPHP をビルドする。

- FrankenPHP の pin だけが変わったときは php のビルドを飛ばし、現行の php の移動タグ（版が pin と一致することを確かめる）の上に組む
- `baseImages.php` が変わったら php と FrankenPHP を、`baseImages.frankenphp` だけなら FrankenPHP を全版ビルドし直す
- ワークフローやスクリプトなどビルドの入力が変わった push では全版をビルドし直す

### 予告がある夜: 版を指定して待つ

```sh
gh workflow run build.yml -R animalife/php-images -f php-version=8.6.1
```

この run は自分では公開しない。

1. php.net で 8.6.1 が公開される（リリース情報に載り、tarball と署名が取れる）まで 3 分おきに確かめる。
   約 5 時間 45 分のうちに公開されなければ run を失敗にする（翌朝に緑を見て済んだと誤解しないように）
2. 公開されたら、その時点の main から `versions.json` の 8.6 を `8.6.1-cli-trixie`（`officialDigest` は `null`）に上げる PR を作り、
   auto-merge を有効にする（チェックが通ればマージキューに入る）。待っている間に main が進んでいても、PR は最新の main から作る
3. 以降は普段の経路: PR の CI（php.net の情報で差し替えた Dockerfile の smoke build を含む）→ マージ → main の push の run が公開する
4. この run は PR がマージされるまで見届ける（watch-bump）。2 時間以内にマージされない・PR が閉じられた・conflict になった・
   チェックが失敗した・auto-merge が外れた（マージキューに入っていないのに）ときは run を失敗にする。App が作った PR の失敗は
   App にしか通知されないので、dispatch した人に届けるため。マージキューに入っている間は待つ。
   閉じられた・conflict のときでも、main の `versions.json` がすでにその版以上なら（official が追いついて Renovate の patch PR が
   先にマージされたなど）成功にし、残った PR を閉じて枝を消す
5. 公式イメージが 8.6.1 を出すと、Renovate が `officialDigest` を埋める PR を作り、push の run が official の Dockerfile で組み直す

- main がすでに 8.6.1 以上なら何もせずに成功する。そのとき 8.6.1 の PR が開いていれば閉じて枝を消す（Renovate に先を越された夜の PR）
- 同じ版の PR がすでに開いていれば、auto-merge が外れていないかを確かめ（外れていれば有効にし直す）、見届けに進む
- 前回の失敗で枝だけが残っていれば、消してから作り直す（force での付け替えは、枝の ruleset で禁止されうるので使わない）
- main の ruleset（必須チェックとマージキュー）が無いと auto-merge を有効にできず、その旨のエラーで失敗する。ruleset を入れてから使う
- PR は専用の GitHub App のトークンで作る（GITHUB_TOKEN で作った PR では CI が起きないため）。コミットは署名が必須なので、
  git push ではなく GitHub が署名する API（createCommitOnBranch）で作る
- 待機中も普段のビルドは止まらない（待つ run は版ごとに別の concurrency グループ）

### 失敗したとき

main の run でどれかのジョブが失敗・取り消しになると Issue を作る（同じタイトルの Issue が開いていればコメントを足す）。
Issue は push・復旧と夜のジョブで分ける。

- push か版を指定しない dispatch の失敗: 「build ワークフローが main で失敗している」。その後、push か版を指定しない dispatch の
  run が成功すると、コメントを残して閉じる
- 夜のジョブの失敗: 「夜のジョブが PHP 8.6.1 を上げられていない」（版ごと）。main の `versions.json` がその版以上になり、
  push か版を指定しない dispatch の run が成功すると、コメントを残して閉じる（無関係な push の成功では閉じない）。人が閉じてもよい

- 夜のジョブ（版を指定した dispatch）は、同じ版を指定して dispatch し直す。PR を作る前に落ちていても、作った後でも、重ねて走らせて問題ない
  （同じ版の PR があるか main がすでにその版なら何もしない）
- 夜の PR のチェックが一時的に落ちた（php.net の取得失敗など）ときは、dispatch し直しても PR のチェックは走り直さない。
  PR のチェックを手で再実行するか、PR を閉じてから同じ版で dispatch し直す
- push の run は、その commit が main の先端なら Re-run all jobs で直せる。main が先へ進んでいれば、再実行は失敗するので、
  版を指定しない workflow_dispatch を main の先端で走らせる。push の差分の基準は「最後に成功した push run」なので、
  失敗した変更は次の push の run にも含まれる
- artifact は JSON が 7 日、FrankenPHP の OCI アーカイブが 3 日で消える。それより古い run は再実行できない

### 全部ビルドし直す

```sh
gh workflow run build.yml -R animalife/php-images
```

## 初回の Actions 実行で確かめること

最初のビルドを走らせる前に、environment `ghcr-publish` を作り、デプロイブランチを main に限っておく。
packages: write を持つジョブ（php-build・php-publish・frankenphp-push・frankenphp-publish）がこの environment を使う。
作る前に走らせると、GitHub が制限なしの environment を自動で作ってしまい、ブランチから dispatch した run も GHCR に書ける。

夜のジョブには次が要る（デプロイブランチを main に限った environment `version-bump` を、bump ジョブが使う）。

- GitHub App（php-images だけにインストール。権限は Contents: write、Pull requests: write、Metadata: read）
- repository variable `VERSION_BUMP_APP_CLIENT_ID`: App の Client ID（空ならトークンを作る前に止まる）
- environment `version-bump` の secret `VERSION_BUMP_APP_PRIVATE_KEY`: App の秘密鍵
- リポジトリの「Allow auto-merge」と、main の ruleset のマージキュー（PR の auto-merge がキューに入るため）
- App の権限で、auto-merge の有効化とマージキューへの投入ができるか（Contents / Pull requests の write で足りるか、
  `merge_queues` の権限も要るか）は、初回の夜のジョブで確かめる

org の設定で、Actions（GITHUB_TOKEN）から GHCR に新しいパッケージを作れるかを確かめておく（パッケージの作成を
メンバーに限る設定などがあると、最初の push が失敗する）。

初回の公開のあと、GHCR のパッケージ（`php-images/php` と `php-images/frankenphp`）は private で作られる。
パッケージの Package settings → Danger Zone → Change visibility で public にする。消費側のリポジトリから読めることも確かめる。

手元では確かめられなかったもの。

- environment `ghcr-publish` のデプロイブランチの制限で、main 以外からの run の公開ジョブが止まること
- マージキュー（merge_group）で ci.yml が走り、`CI Gate` が成功すること
- run 全体の `concurrency.queue: max` が効き、push の run が commit 順に直列で走ること
- 夜のジョブが PR を作り（App のトークン、createCommitOnBranch の署名付きコミット）、auto-merge がマージキューに入ること
- Renovate が `officialDigest: null` を埋める pinDigest の PR を、`versions.json` の書式を崩さずに作ること
- `uses: $/.github/actions/publish-image` で composite action が解決されること
- GHCR への push・attestation の push（`gh attestation verify` が通る）
- main の run が失敗したときに Issue ができること（同名の Issue が開いていればコメントになること）
- 公開ジョブで、main の `versions.json` を `git fetch origin main` で読めること
- amd64 のビルド（手元では arm64 だけを確かめた）

## 開発

```sh
npm test                                        # scripts/ の単体テスト（Node 24）
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua i     # jactionlint / zizmor（CI でだけ使う）
AQUA_CONFIG=.github/aqua.yaml aqua i            # container-structure-test（build.yml が使う）
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua exec -- jactionlint --profile correctness
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua exec -- zizmor --persona pedantic .
```

- アクションは完全な commit SHA で pin する。`.github/workflows/actions.lock` は `gh actions-lock --no-narrow` で作り直す。
  SHA のまま残るのはリポジトリの Actions の設定 `sha_pinning_required` が有効だからで、無効だと gh actions-lock は SHA をタグ参照に置き換える
- Renovate は、PR の CI で実行されない action（login・upload/download-artifact・attest・create-github-app-token）を手動マージにしている
  （公開権限や App の鍵を持つ main の run で初めて動くため）
- aqua のツールの版を変えたら、その設定ごとに `AQUA_CONFIG=<設定> aqua update-checksum --prune` で checksum を作り直す。
  `.github/aqua.yaml` はビルドの入力（変えると全版を作り直す）、`.github/aqua-ci/aqua.yaml` は CI だけで使う
- PR とマージキューでは `.github/workflows/ci.yml` が lint・テスト・親イメージの pin の検査・php の amd64 のビルド（push しない）・
  Renovate 設定の検証・actions.lock の検証を行い、`CI Gate` に集約する

### GHCR の untagged

再ビルドのたびに、タグの外れた index とアーキごとの manifest が残る。untagged を単純に消すと、タグ付きの index が
参照している子の manifest（アーキごとの manifest や attestation）まで消えてイメージが壊れる。掃除するなら、
index からの参照を検証してから消す仕組みを使う
