# HarborClient HTTPie Plugin

Adds an **HTTPie** tab to the request editor that shows an equivalent `http` command for the configured request and provides a copy button.

## Install

Build the plugin, then install the `.hcp` package or load the project folder unpacked:

```bash
pnpm install
pnpm build
```

In HarborClient: **Settings → Plugins → Load unpacked…** and select this directory.

## Development

```bash
pnpm dev
```

Rebuilds `dist/renderer.js` on change when HarborClient file watching is enabled for unpacked plugins.

## Limitations

| Aspect           | Behavior                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| Variables        | Resolved from collection + active environment (environment wins on dupes) |
| Cookie jar       | Not included unless a `Cookie` header is set manually                     |
| Pre/post scripts | Do not affect displayed HTTPie command                                    |
| Multipart files  | Uses stored file paths (`field@/path`) on the local machine               |

## License

MIT
