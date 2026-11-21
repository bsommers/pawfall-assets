# pawfall-assets

Colby the jungle cat: sprites, tiles, fx, sfx and chiptune songs extracted from PawFall (procedural, deterministic).

Reusable game assets in the game-factory asset-library format. Browse [INDEX.md](INDEX.md) (human, with previews)
or read [INDEX.json](INDEX.json) (machine). License: CC0-1.0.

## Layout

```
library.json            manifest (name, version, license, tags, asset types)
assets/<id>/asset.json  descriptor: id, type, version, tags, license, author, files + sha256, dependencies, preview, hash
assets/<id>/...         the asset files and preview
INDEX.json, INDEX.md    generated; never edit by hand
tools/library/          standalone validator and indexer (zero dependencies, Node 22+)
```

## Use

```sh
node tools/library/validate-cli.mjs validate .       # schema, hashes, paths, dependencies
node tools/library/validate-cli.mjs index .          # regenerate INDEX.json / INDEX.md
node tools/library/validate-cli.mjs index . --check  # fail when the index is stale (CI)
```

Add assets with the factory: `factory library add <this dir> --from <game project>` (or the `library.add` capability),
install into a game with `factory library install`, which writes `assets.lock.json` with sha256 hashes.
Add this library to a registry with `factory registry add <owner>/pawfall-assets@main`.
Assets are data only: installing never runs code.
