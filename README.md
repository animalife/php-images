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
- 公開した index には GitHub の artifact attestation（SLSA build provenance）を付ける。確かめるには

  ```sh
  gh attestation verify oci://ghcr.io/animalife/php-images/frankenphp:php8.6-trixie \
    --repo animalife/php-images \
    --signer-workflow animalife/php-images/.github/workflows/build.yml \
    --source-ref refs/heads/main
  ```

- 固定タグも、同じ版のまま作り直すと指す先が変わる。親イメージ（`baseImages`）や上流の Dockerfile の更新、
  ビルドの入力の変更で再ビルドすると、同じ `8.6.0-cli-trixie` / `1.14.0-php8.6.0-trixie` が新しい digest を指す。
  内容を固定したいときは digest で参照する
- 移動タグは古い版へは戻さない（並走した run の巻き戻しを防ぐため）。意図的に戻すときは手で付け替える。
  公開の判定は次のとおり（`scripts/lib/publish.mjs`）
  - この run がビルドに使った pin（`baseImages` や FrankenPHP の pin。php では php に関わるものだけ）が main の先端より古ければ、
    push の run はタグを付けずに終える（後続の run が組み直す）。版を指定した待機 run は失敗にする
  - 現行の移動タグの方が新しければ、固定タグだけ付ける
  - FrankenPHP と PHP の一方が上がり一方が下がる場合は、タグを付けずに run を失敗にする
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
  追うタグや os などそれ以外は dispatch した時点の値を使い、移動タグに載せるかの判定もこの「実際に使った値」で行う
- FrankenPHP は必ずこの run がビルドした php の上に組む
- 作ったイメージは php と FrankenPHP の移動タグに必ず載せる。載せられないとき（ビルド中に main の pin が進んだ、
  版の一方が下がる）は run を失敗にする。同じ版を指定して dispatch し直せば、新しい pin で組み直す
- 例外として、現行の移動タグがすでに同じかそれ以上の版をすべて持っている（official-images がより新しい版に追いついた
  など）ときは、移動タグを動かさず固定タグだけ付けて成功にする。セキュリティ版はすでに移動タグに載っているため
- 待機中も普段のビルドは止まらない（待機 run は版ごとに別の concurrency グループ）

### 全部ビルドし直す

```sh
gh workflow run build.yml -R animalife/php-images
```

## 初回の Actions 実行で確かめること

手元では確かめられなかったもの。

- ジョブ単位の `concurrency.queue: max`（publish ジョブ）が効き、待機中の公開が取り消されないこと
- `uses: $/.github/actions/publish-image` で composite action が解決されること
- GHCR への push・attestation の push（`gh attestation verify` が通る）・パッケージの可視性
- 待機 run で、main の `versions.json` を `git fetch origin main` で読み直せること
- amd64 のビルド（手元では arm64 だけを確かめた）

## 開発

```sh
npm test                                        # scripts/ の単体テスト（Node 24）
export AQUA_CONFIG=.github/aqua.yaml && aqua i  # jactionlint / zizmor / container-structure-test
jactionlint --profile correctness
zizmor --persona pedantic .
```

- アクションは完全な commit SHA で pin する。`.github/workflows/actions.lock` は `gh actions-lock --no-narrow` で作り直す
- aqua のツールの版を変えたら `AQUA_CONFIG=.github/aqua.yaml aqua update-checksum --prune` で checksum を作り直す
- PR では `.github/workflows/ci.yml` が lint・テスト・親イメージの pin の検査・Renovate 設定の検証・actions.lock の検証を行い、`CI Gate` に集約する
