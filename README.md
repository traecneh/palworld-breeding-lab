# Palworld Breeding Lab

`palworld-breeding-lab` is a standalone static site for browsing Palworld breeding data. The exported JSON and icon assets live inside this project so it can be hosted directly on GitHub Pages.

## Structure

- `index.html`, `app.js`, `styles.css`: the site itself
- `data/palworld-breeding-data.json`: exported breeding data snapshot
- `data/pal-icons/` and `data/pal-icons-thumb/`: exported icon assets
- `start-local-site.ps1`: local preview server
- `sync-palworld-data.ps1`: refreshes the local `data/` folder from a Palworld install

## Local Preview

From this project folder:

```powershell
.\start-local-site.ps1
```

That serves the site at:

```text
http://127.0.0.1:4174/
```

## GitHub Pages

This project is ready to publish as a GitHub Pages project site.

- It is a plain static site with no server-side runtime.
- HTML, CSS, JavaScript, JSON, and image assets all use relative paths, so it works from either `/` or a repository subpath such as `/palworld-breeding-lab/`.
- The included `.nojekyll` file prevents GitHub Pages from trying to process the site as a Jekyll project.

Recommended Pages settings:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/(root)`

## Refresh Game Data

After re-running `PalworldBreedingExtract`, pull the latest export into this repo with:

```powershell
.\sync-palworld-data.ps1
```

If your game is installed somewhere else:

```powershell
.\sync-palworld-data.ps1 -PalworldRoot 'D:\Games\Palworld'
```

## Notes

- The site searches both display names and internal tribe ids.
- Results show every inferred breeding pair for the selected child Pal.
- Gender requirements are shown when the extracted unique-combo data specifies them.
- Relative asset paths make the project safe to host either at a GitHub Pages root or under a project subpath.
