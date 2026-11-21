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
    --signer-workflow animalife/php-images/.github/workflows/build.yml
  ```

- 移動タグは古い版へは戻さない（並走した run の巻き戻しを防ぐため）。意図的に戻すときは手で付け替える。
  FrankenPHP と PHP の一方が上がり一方が下がる場合は、固定タグだけ付けて run を失敗にする（新しい方の PHP の版を指定した dispatch で揃える）
- `staging-*` タグは attestation を付ける前の一時置き場で、使わない

## 設定: versions.json

ビルドする版は `versions.json` の 1 ファイルで決まる。

- `php.<minor>`: `officialTag` は「追うタグ」（公式 `php` イメージのタグ）。FrankenPHP は ZTS の PHP を前提にするので、
  8.6 以上は `<minor>-cli-<os>`、8.5 以下は `<minor>-zts-<os>`（上流の docker-bake.hcl の `php_base_variant` と同じ。
  食い違うとビルドが止まる）。`officialDigest` はそのタグの公式イメージの digest で、Renovate が更新する
- `frankenphp`: 上流のタグと commit。Renovate が両方を同時に更新し、ビルドはタグが commit を指しているかを確かめる
- `platforms`: プラットフォームとランナー

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

php の Dockerfile は、official-images の `library/php` で追うタグの `GitCommit` と `Directory` を引き、
その commit の docker-library/php のディレクトリを取得して使う。ワークフローやスクリプトなどビルドの入力が変わった push では全版をビルドし直す。

### 予告がある夜: 版を指定して待つ

```sh
gh workflow run build.yml -R animalife/php-images -f php-version=8.6.1
```

php.net で 8.6.1 が公開される（リリース情報に載り、tarball と署名が取れる）まで 3 分おきに確かめ、公開されたら
上流の Dockerfile の `PHP_VERSION` / `PHP_URL`・`PHP_ASC_URL` / `PHP_SHA256` だけを差し替えてビルドする。
`GPG_KEYS` は差し替えないので、`.asc` の署名検証は上流の Dockerfile のまま行われる。

- 約 5 時間 45 分のうちに公開されなければ、失敗にせずビルドしないで終える
- official-images がすでにその版（以降）に追いついていれば、差し替えずにそのままビルドする
- FrankenPHP は、dispatch した時点ではなく公開を確認した時点の main の pin でビルドする
- 待機中も普段のビルドは止まらない（待機 run は版ごとに別の concurrency グループ）

### 全部ビルドし直す

```sh
gh workflow run build.yml -R animalife/php-images
```

## 開発

```sh
npm test                                        # scripts/ の単体テスト（Node 24）
export AQUA_CONFIG=.github/aqua.yaml && aqua i  # jactionlint / zizmor / container-structure-test
jactionlint --profile correctness
zizmor --persona pedantic .
```

- アクションは完全な commit SHA で pin する。`.github/workflows/actions.lock` は `gh actions-lock --no-narrow` で作り直す
- aqua のツールの版を変えたら `AQUA_CONFIG=.github/aqua.yaml aqua update-checksum --prune` で checksum を作り直す
- PR では `.github/workflows/ci.yml` が lint・テスト・Renovate 設定の検証・actions.lock の検証を行い、`CI Gate` に集約する
