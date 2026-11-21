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
  公開を main の run に限る本当の境界はこの検証（`--source-ref refs/heads/main` と `--signer-workflow`）で、消費側はこれを必ず通す前提にする。
  environment `ghcr-publish` は誤操作のガードで、書き込み権限者がブランチ上で外せば GHCR には書ける

- 固定タグも、同じ版のまま作り直すと指す先が変わる。親イメージ（`baseImages`）や上流の Dockerfile の更新、
  ビルドの入力の変更で再ビルドすると、同じ `8.6.0-cli-trixie` / `1.14.0-php8.6.0-trixie` が新しい digest を指す。
  内容を固定したいときは digest で参照する
- 移動タグは古い版へは戻さない（並走した run の巻き戻しを防ぐため）。意図的に戻すときは手で付け替える。
  公開の判定は次の順に決まる（`scripts/lib/publish.mjs`）
  - この run がビルドに使った pin（`baseImages` や FrankenPHP の pin。php では php に関わるものだけ）が main の先端より古ければ、
    push の run はタグを付けずに成功で終える（後続の run が組み直す）。再実行（Re-run）した push の run は失敗にする。
    待機 run は同じ版で起動し直す（下の「予告がある夜」）。
    後続の run は main への push で起きることを前提にしている。`[skip ci]` などでワークフローが起きない push だと
    組み直されないので、そのときは版を指定しない workflow_dispatch で全部ビルドし直す
  - 版が現行の移動タグと同じで、移動タグの方が公開時点の `library/php` の GitCommit（新しい上流の Dockerfile）で組まれ、
    今回はそうでなければ、上書きしない（タグを付けずに成功）。古い Dockerfile で組んだ run が後から公開して中身を戻さないように
  - 版がすべて現行以上なら（同じ版を含む）、固定タグと移動タグを付ける
  - 現行の移動タグの方が新しければ（版がすべて現行以下で、どれかが小さい）、固定タグだけ付ける
  - FrankenPHP と PHP の一方が上がり一方が下がる場合は、タグを付けずに run を失敗にする
- push の run は、php の移動タグが official-images より新しい版（待機 run が php.net から組んだもの）を指していれば、
  その版に差し替えて組む。official-images の版のまま組むと移動タグを動かせず、親イメージの更新が届かないため
- `staging-*` タグは attestation を付ける前の一時置き場で、使わない

## 設定: versions.json

ビルドする版は `versions.json` の 1 ファイルで決まる。

- `php.<minor>`: `officialTag` は「追うタグ」（公式 `php` イメージのタグ）。FrankenPHP は ZTS の PHP を前提にするので、
  8.6 以上は `<minor>-cli-<os>`、8.5 以下は `<minor>-zts-<os>`（上流の docker-bake.hcl の `php_base_variant` と同じ。
  食い違うとビルドが止まる）。`officialDigest` はそのタグの公式イメージの digest で、Renovate が更新する。
  これはビルドのきっかけで、内容は固定しない。ビルドする Dockerfile は、ビルドした時点の `library/php` の `GitCommit` から取る
- `frankenphp`: 上流のタグと commit。Renovate が両方を同時に更新し、ビルドはタグが commit を指しているかを確かめる
- `baseImages`: 上流の Dockerfile がタグだけで参照する親イメージ（docker-library/php の `FROM debian:trixie-slim`、
  FrankenPHP の bake の `golang-base` や `# syntax=docker/dockerfile:1` など）の digest。`php` と `frankenphp` に分けて持つ。
  上流の Dockerfile は書き換えず、名前付きコンテキスト（`--build-context` / bake の `contexts`）と `BUILDKIT_SYNTAX` で差し替える。
  取得した Dockerfile や bake の定義が pin の無いイメージを参照していたらビルドを止める（上流が親イメージを変えたら、ここに足して直す）。
  Renovate が digest だけを更新する
- `platforms`: プラットフォームとランナー。ワークフローの `runs-on` と揃えて手で上げる（Renovate はランナーのメジャー更新を提案しない）

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
  "officialTag": "8.5-zts-trixie",
  "officialDigest": "sha256:<docker buildx imagetools inspect php:8.5-zts-trixie の digest>"
}
```

## ビルドの経路

ワークフローは `.github/workflows/build.yml` の 1 本で、php → FrankenPHP を同じ run の中でつなぐ。

### 普段: Renovate の更新 PR のマージ

1. docker-library/php が更新されて公式イメージが出直すと、Renovate が `officialDigest` を更新する PR を作り、自動マージする
2. main への push で、差分のあった版の php を docker-library/php の Dockerfile からビルドし、続けて FrankenPHP をビルドする
3. FrankenPHP の pin だけが変わったときは php のビルドを飛ばし、現行の php イメージで FrankenPHP をビルドする
4. `baseImages.php` が変わったら php と FrankenPHP を、`baseImages.frankenphp` だけなら FrankenPHP を全版ビルドし直す

php の Dockerfile は、official-images の `library/php` で追うタグの `GitCommit` と `Directory` を引き、
その commit の docker-library/php のディレクトリを取得して使う。ワークフローやスクリプトなどビルドの入力が変わった push では全版をビルドし直す。

### 予告がある夜: 版を指定して待つ

```sh
gh workflow run build.yml -R animalife/php-images -f php-version=8.6.1
```

php.net で 8.6.1 が公開される（リリース情報に載り、tarball と署名が取れる）まで 3 分おきに確かめ、公開されたら
上流の Dockerfile の `PHP_VERSION` / `PHP_URL`・`PHP_ASC_URL` / `PHP_SHA256` だけを差し替えてビルドする。
`GPG_KEYS` は差し替えないので、`.asc` の署名検証は上流の Dockerfile のまま行われる。

- 約 5 時間 45 分のうちに公開されなければ、ビルドせずに run を失敗にする（翌朝に緑を見てビルド済みと誤解しないように）
- official-images がすでにその版（以降）に追いついていれば、差し替えずにそのままビルドする
- pin（`baseImages` と `frankenphp`）は dispatch した時点ではなく、公開を確認した時点の main のものを使う。
  追うタグや os などそれ以外は dispatch した時点の値を使い、移動タグに載せるかの判定もこの「実際に使った値」で行う。
  スクリプトとワークフローも dispatch した時点のもので動く（待機中に main で直したものは、その run には効かない）
- FrankenPHP は必ずこの run がビルドした php の上に組む
- 作ったイメージは php と FrankenPHP の移動タグに必ず載せる
  - ビルド中に main の pin が進んで古い pin になったときは、タグを付けずに、同じ版を指定した run を自動で起動し直す
    （新しい run は main の新しい pin で組み、php.net にはもう版があるのですぐビルドに入る）。この run は緑で終わり、
    Summary に起動し直したことが出るので、結果は新しい run で確かめる。起動し直すのは 3 回までで、上限に達したら失敗にする。
    再実行（Re-run）した待機 run でも同じように起動し直す
  - 版の一方が下がる（conflict）など、pin を新しくしても直らないものは起動し直さずに失敗にする
- 例外として、次のときは移動タグを動かさずに成功にする。どちらもセキュリティ版はすでに移動タグに載っている
  - 現行の移動タグの方が新しい版を持つ（official-images がより新しい版に追いついたなど）。固定タグだけ付ける
  - 同じ版が、新しい上流の Dockerfile で組まれてすでに移動タグにある。タグを付けない
- 版を打ち間違えていないか、待ち始める前に確かめる。現行の移動タグより大きく、+3 パッチ以内でなければ待たずに失敗する
  （移動タグがまだ無い初回は確かめない）
- 待機中も普段のビルドは止まらない（待機 run は版ごとに別の concurrency グループ）

### 失敗したとき

main の run でどれかのジョブが失敗・取り消しになると、Issue「build ワークフローが main で失敗している」を作る（開いていればコメントを足す）。

- 待機 run（版を指定した dispatch）は、Re-run ではなく同じ版を指定して dispatch し直す（`redispatch-count` は 0 のまま）
- push の run は Re-run all jobs か、版を指定しない workflow_dispatch で直す。push の差分の基準は「最後に成功した push run」なので、
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

初回の公開のあと、GHCR のパッケージ（`php-images/php` と `php-images/frankenphp`）は private で作られる。
パッケージの Package settings → Danger Zone → Change visibility で public にする。消費側のリポジトリから読めることも確かめる。

手元では確かめられなかったもの。

- environment `ghcr-publish` のデプロイブランチの制限で、main 以外からの run の公開ジョブが止まること
- マージキュー（merge_group）で ci.yml が走り、`CI Gate` が成功すること
- ジョブ単位の `concurrency.queue: max`（publish ジョブ）が効き、待機中の公開が取り消されないこと
- `uses: $/.github/actions/publish-image` で composite action が解決されること
- GHCR への push・attestation の push（`gh attestation verify` が通る）
- main の run が失敗したときに Issue ができること（同名の Issue が開いていればコメントになること）
- 待機 run で、main の `versions.json` を `git fetch origin main` で読み直せること
- amd64 のビルド（手元では arm64 だけを確かめた）

## 開発

```sh
npm test                                        # scripts/ の単体テスト（Node 24）
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua i     # jactionlint / zizmor（CI でだけ使う）
AQUA_CONFIG=.github/aqua.yaml aqua i            # container-structure-test（build.yml が使う）
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua exec -- jactionlint --profile correctness
AQUA_CONFIG=.github/aqua-ci/aqua.yaml aqua exec -- zizmor --persona pedantic .
```

- アクションは完全な commit SHA で pin する。`.github/workflows/actions.lock` は `gh actions-lock --no-narrow` で作り直す
- aqua のツールの版を変えたら、その設定ごとに `AQUA_CONFIG=<設定> aqua update-checksum --prune` で checksum を作り直す。
  `.github/aqua.yaml` はビルドの入力（変えると全版を作り直す）、`.github/aqua-ci/aqua.yaml` は CI だけで使う
- PR とマージキューでは `.github/workflows/ci.yml` が lint・テスト・親イメージの pin の検査・php の amd64 のビルド（push しない）・
  Renovate 設定の検証・actions.lock の検証を行い、`CI Gate` に集約する

### GHCR の untagged

再ビルドのたびに、タグの外れた index とアーキごとの manifest が残る。untagged を単純に消すと、タグ付きの index が
参照している子の manifest（アーキごとの manifest や attestation）まで消えてイメージが壊れる。掃除するなら、
index からの参照を検証してから消す仕組みを使う
