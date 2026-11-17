# DSH native presentation components

The display settings preview reuses selected SVG artwork and presentation CSS from @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-sidebar and @deepseek-ai/dsh-client-ui-conversation, version 0.2.0-rc.2. Source: the corresponding packages shipped with DeepSeek Harness Desktop.

Artwork is reused without geometry changes. Presentation styles are scoped and adapted into separate regions at normal text size. The preview uses the host's exported primitives when available.

The standalone ledger worker also bundles the home-directory resolver from @deepseek-ai/dsh-home-paths 0.2.1-rc.1, under the same DeepSeek MIT license below. It does not bundle the host runtime or credential services.

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


# Sidebar brand logos (Lobe Icons)

The optional Icons sidebar embeds monochrome path geometry from
[`@lobehub/icons-static-svg` 1.102.0](https://www.npmjs.com/package/@lobehub/icons-static-svg/v/1.102.0),
[Lobe Icons source commit `989535d6c13da2dec5a2937fe2789d4af4fdd8e0`](https://github.com/lobehub/lobe-icons/tree/989535d6c13da2dec5a2937fe2789d4af4fdd8e0).
Original SVG filenames and SHA-256 hashes are recorded in `src/sidebar-icons/logos.json`;
`node scripts/import-sidebar-logos.mjs <extracted package directory> --check` verifies the offline import.
Paths, view boxes, fill rules and opacity are retained; root sizing/style and decorative titles are replaced by local React/SVG presentation. No SVG markup, scripts or remote image references are executed.

Included symbols: DeepSeek, Claude, OpenAI, OpenCode, Qwen, Z.ai, MiniMax, Kimi,
OpenRouter, SiliconCloud (SiliconFlow), CommandCode, Cline, Volcengine, Xiaomi MiMo,
Baidu Cloud and WorkBuddy. These identify their respective providers/products;
trademarks remain with their owners and no affiliation or endorsement is implied.
OpenAI identifies the Codex provider, not a claim that it is a distinct Codex product logo.
OpenDesign, SCNet, Factory and unknown/custom gateway sources keep the existing neutral/initial fallback rather than an unrelated brand.

MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

# WorkBuddy credential and billing support

Adapted from [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect), `src/auth.ts` and `src/upstream.ts`. Local credentials are read only; this plugin does not refresh tokens.

The additional usage-route compatibility is based on the public API of [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy/tree/2c1626b8dc46e16561924b76ac6cd86b4272e45d) 4.13.1 (`src/status-paths.ts`, `src/web-status.ts`; MIT, Copyright (c) 2026 LaoDing). Tests execute its published route with synthetic dependencies; its credential and account-management implementation is not included in this package.

MIT License

Copyright (c) 2026 Corrine Hu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
