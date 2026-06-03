# Listen to papers from your Zotero library

This open-source Zotero desktop plugin turns a selected local PDF attachment
into paper audio with read-along text, saved progress, and a reader page you
can continue on the web or in the iOS app. It is built for researchers,
students, and knowledge workers who keep papers in Zotero but want a better way
to listen while walking, commuting, or reviewing dense material.

The plugin uses [listen2papers.com](https://listen2papers.com) to process the
selected paper and create the audio/read-along page. There is a free tier for
roughly 5-10 papers per month, depending on paper size. You do not need to sync
your whole Zotero account or upload your library. The plugin only acts on the
paper you explicitly choose.

![listen2papers for Zotero workflow](assets/zotero-plugin-workflow.png)

## What It Does

- Adds a `Listen to this paper` command to Zotero Desktop.
- Works with one selected Zotero item or PDF attachment at a time.
- Uses a local PDF attachment from Zotero Desktop.
- Creates paper audio with synchronized read-along text.
- Opens a saved reader page you can continue on the web or in the iOS app.
- Opens the created reader page in the browser after upload.
- Sends title, DOI, URL, Zotero item key, attachment key, library id, and author
  metadata when available.
- Validates the configured listen2papers API URL before reading or uploading the
  selected local PDF.
- Checks Zotero's local file size metadata before upload when available and
  alerts locally for PDFs over the 25 MB plugin upload limit.

## Install

1. Download `listen2papers-zotero.xpi` from the latest GitHub release or from
   `https://listen2papers.com/zotero/listen2papers-zotero.xpi`.
2. In Zotero Desktop, open `Tools -> Plugins`.
3. Choose `Install Plugin From File...` from the gear menu and select the XPI.
4. Restart Zotero if prompted.
5. In listen2papers, open `Settings` and generate a Zotero desktop plugin token.
6. In Zotero, set these preferences:
   - `extensions.listen2papers.apiBaseUrl` to `https://listen2papers.com`
   - `extensions.listen2papers.token` to your plugin token
   - `extensions.listen2papers.autoGenerateAudio` to `true` or `false`

## Use

1. Select one Zotero item with a local PDF attachment.
2. Right-click the item.
3. Choose `Listen to this paper`.
4. The plugin uploads the PDF and opens the generated audio/reader page.

## Compatibility

- Zotero `7.0` through `9.0.*`
- macOS, Windows, and Linux should work where Zotero supports bootstrapped
  plugins, but the initial release has been smoke-tested most heavily on macOS.

Runtime evidence before the public `v0.1.0` release:

- Zotero 7.0.30 source-proxy headless startup smoke.
- Zotero 8.0.5 packed-XPI headless startup smoke.
- Zotero 9.0.4 packed-XPI headless and GUI upload smoke.

## Privacy And Security

Zotero plugins run with local desktop privileges. Only install XPI files from
trusted release channels.

This plugin reads only the selected local PDF attachment after the API URL and
token pass validation. It does not sync your Zotero account or upload your full
Zotero library. It sends the PDF to `https://listen2papers.com` with Zotero
metadata such as title, DOI, URL, library id, item key, attachment key, and
authors when available.

Authentication uses a scoped bearer token created in listen2papers Settings,
not your listen2papers password. The server stores only a hash of that token,
and you can revoke the token from Settings.

## Who Built This

I am Alexander Adamov, a solo builder in Berlin working on applied AI tools for
research and knowledge work. listen2papers is my product for turning academic
papers and PDFs into listenable audio with read-along text, saved progress, and
an iOS app for listening on the go.

## Positioning

Zotero 9 includes built-in Read Aloud for quick local playback. This plugin is
for users who want paper-aware audio, synchronized read-along text, saved
progress, and an iOS app for listening outside Zotero.

## Updates

The XPI manifest points Zotero to:

`https://listen2papers.com/zotero/updates.json`

That manifest advertises the latest hosted release and SHA-256 hash.

## Build

```sh
npm run package
```

The package script writes:

- `dist/listen2papers-zotero.xpi`
- `dist/updates.json`
- `dist/SHA256SUMS.txt`

## Support

Use the listen2papers support link on the website or open a GitHub issue with:

- Zotero version
- operating system
- plugin version
- whether the selected Zotero item has a local PDF attachment
- any visible Zotero alert text

## License

No open-source license is declared yet. The source is published for release
transparency and user inspection.
