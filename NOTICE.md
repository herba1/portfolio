# Third-party notices

## src/app/backdrop — animated artwork gradient

This route reimplements the animated now-playing backdrop seen on Apple Music
for the web. No Apple source was copied into this repository, and the rendering
pipeline (raw WebGL, framebuffer ping-pong, padded filter targets, folded
composite pass) was written from scratch — Apple's runs on PixiJS.

Two things in it are not original work and are acknowledged here.

### 1. Fragment shaders — pixi-filters (MIT)

The twist, Kawase blur and adjustment fragment shaders in
`src/app/backdrop/gradientScene.js` are derived from **pixi-filters**
(`TwistFilter`, `KawaseBlurFilter`, `AdjustmentFilter`), which is open source
under the MIT licence and maintained by the PixiJS organisation. Apple bundles
those same filters; the shader text originates with PixiJS, not with Apple.

    The MIT License (MIT)
    Copyright (c) 2013-2023 Mathew Groves, Chad Engler
    https://github.com/pixijs/filters

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### 2. Tuning constants — observed from Apple Music for the web

The numeric parameters that produce the look — twist angle and radius, the blur
kernel ladder, saturation / contrast / brightness, the scrim alphas, the four
sprite scale ratios, their per-sprite rotation rates, and the frame cap — were
measured from Apple Music's publicly served JavaScript. They are recorded as
configuration values, not copied code. This route is a study of a published
visual effect and is not affiliated with or endorsed by Apple.

### 3. Media

This route ships no third-party media. `public/backdrop/fallback.jpg` is an
abstract image generated for this repository and is the only bundled artwork.

The default track, its cover and its audio are all resolved at runtime through
`/api/itunes/search` and streamed from Apple's CDN, which serves 30-second
previews under Apple's own licences with the artwork on a permissive CORS
policy. Nothing is copied into this repository or into the deployed build.

`public/audio/` holds a local clip used only by the `/ask-me-why` route. It is
git-ignored, has never been committed, and is therefore absent from any
deployment.
