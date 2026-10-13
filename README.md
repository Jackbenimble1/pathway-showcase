# Pathway Showcase

A static, GitHub Pages-ready editor for player-facing visual previews of the Practice's pathways. It uses a shared 1600 × 900 layout inspired by the composition of JUNI's fan-made Deadlock Character Splash template, but it is not a Toyhouse embed and requires no Toyhouse, framework, external image libraries, fonts, or server-side code.

## Publish to GitHub Pages

1. Unzip the archive and put **the contents of the `pathway-showcase` folder** in the root of a GitHub repository (`index.html`, `editor.css`, `app.js`, `pathways.json`, `themes/`, `assets/`, `profiles/`). Do **not** upload only `index.html`.
2. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then choose **main** and **/(root)**, and save.
3. GitHub Pages will provide an address like `https://USERNAME.github.io/REPO/`. It can take a few minutes to publish. No build step is needed.

For local testing, do not double-click `index.html`: browser `file://` security can block the JSON and CSS file fetches. Run `python -m http.server 8000` in the folder and visit `http://localhost:8000` instead.

## Editing

- Choose a pathway in the dropdown. All **27 pathway names** were taken from the current authoritative pathway title reference; non-Sun entries are intentionally **unwritten placeholders** to avoid introducing lore or spoilers.
- Change name, descriptors, summary, quote, three tags, four highlighted abilities and icons, and portrait placement.
- The Sun pathway starts with the provided blond iconic portrait and a gold/ivory theme. Its textual ability entries are intentionally placeholders.
- Open **Pathway CSS** to change any of the selected pathway's CSS variables; every pathway has a distinct source file in `themes/NAME.css`.
- Click **Download PNG** for a 1600×900, 3200×1800, or 4800×2700 image. The preview and export use the same HTML Canvas drawing routine, so all foreground elements and the selected artwork are included.
- **Export JSON** downloads a standalone copy of the selected pathway's content, theme CSS, and portrait (embedded as a data URL). Keep these JSON files as backups or on another device. **Import JSON** loads them.
- **Publish a finished pathway:** export JSON (for example, `sun.json`), put it in the repository's `profiles/` folder, and commit it. On the deployed site this becomes the shared default for anyone without local edits. If you changed colors or fonts, also download the CSS and replace that pathway's file in `themes/`.
- **Discard local edits** reloads a published profile/theme (or the bundled default) after confirmation. This is useful after updating files on GitHub.
- **Download CSS** saves the currently edited pathway theme. To make CSS tweaks visible to all site visitors, replace its `themes/NAME.css` file in the GitHub repository with your downloaded CSS.

### Where edits are stored

Browser edits autosave locally using **IndexedDB**, scoped to the browser and GitHub Pages URL. They are **not committed to GitHub**, **not shared between browsers**, and **not uploaded to any service** until you manually upload an exported profile into `profiles/`. Browser private modes or storage clearing can erase them, so export JSON copies when you finish a page.

If your goal is to publish finished pathway pages publicly, commit the corresponding exported JSON to `profiles/` or upload the PNGs wherever you display your player handouts. The editor itself is editable by anyone who opens its public GitHub Pages URL, but each person's edits stay inside their own browser.

### Per-pathway CSS contract

Each `themes/*.css` file defines `:root` variables consumed by the shared renderer:

- `--accent`: main highlight and geometric line color
- `--text`: headings and bright text
- `--body-text`: body-copy color
- `--background`: page background and blending color
- `--panel`: reserved panel fill variable
- `--panel-border`: reserved panel edge variable
- `--font-display`, `--font-body`: font family stacks (system fonts recommended)
- `--pattern`: `rings`, `rays`, `grid`, `lattice`, `waves`, or `shards`
- `--ornament-opacity`: number 0–1
- `--portrait-overlay`: number 0–1

CSS custom properties control the Canvas graphics; the canvas does not directly render arbitrary HTML/CSS layout rules. For intentional consistency, geometry and placement of panels is controlled by `app.js`. For changing the layout itself, edit `drawTopPanel`, `drawAbility`, `drawPortrait`, and related functions.

## Credits

Layout concept inspired by JUNI's [Deadlock Character Splash](https://toyhou.se/38106617.deadlock-character-splash) fan template, which credits assets from Valve's Deadlock. This site uses its own code and geometric background rather than embedding Toyhouse's HTML, graphics or branded assets. Sun portrait supplied by the campaign creator.
