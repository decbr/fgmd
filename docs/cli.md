# CLI

The CLI lets PHP, Python, Ruby or Go builds use fgmd.

```sh
fgmd post.md > post.html
cat post.md | fgmd --options '{"html":true,"breaks":true}' --plugins callouts,typography,emoji
```

`--options` takes any JSON-serialisable [option](options.md), and `--plugins` takes [plugin](plugins.md) names.

For pages whose metadata lives in a `---` block at the top of the file, `--frontmatter` keeps that block out of the HTML, and `--data` prints its keys and values as JSON instead of rendering:

```sh
fgmd --frontmatter example.md > example.html
fgmd --data example.md
# { "title": "Page Title", "blurb": "Page Blurb" }
```

`npm run build` also produces `dist/fgmd.mjs`, the whole CLI in one file with no imports. You can copy it into a project that has no `package.json` and run it with plain `node`. There, the `emoji` plugin includes GitHub's full shortcode set.

## Serve mode

For builds that render many documents, `--serve` keeps one process alive:
- **Requests:** one JSON object per line on stdin, `{"src": "…", "options"?: {…}, "inline"?: true}`. `options.plugins` takes names.
- **Responses:** one line each on stdout, in order: `{"html": "…"}` or `{"error": "…"}`. With `--frontmatter`, a document that has a block also gets `"data"`.
- **Defaults:** options given on the command line apply to every request.

From PHP:

```php
const FGMD_OPTIONS = ['html' => true, 'breaks' => true, 'plugins' => ['callouts', 'typography']];

function markdown(string $text): string {
    static $proc = null, $pipes = [];
    if ($proc === null) {
        $proc = proc_open(
            ['node', __DIR__ . '/tools/fgmd.mjs', '--serve', '--options', json_encode(FGMD_OPTIONS)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => STDERR],
            $pipes
        );
        if (!is_resource($proc)) {
            fwrite(STDERR, "could not start fgmd\n");
            exit(1);
        }
    }
    fwrite($pipes[0], json_encode(['src' => $text], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n");
    $line = fgets($pipes[1]);
    $response = $line === false ? null : json_decode($line, true);
    if (!isset($response['html'])) {
        fwrite(STDERR, 'fgmd failed: ' . ($response['error'] ?? 'no response - is node installed?') . "\n");
        exit(1);
    }
    return $response['html'];
}
```
