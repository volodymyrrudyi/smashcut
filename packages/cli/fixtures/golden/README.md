The visual fixture covers text, subtitles, image composition, frame chrome, decor and React output using the
repository's Inter font. The integration suite also checks analytic RGB golden frames for solid/image/fade
composition, moving footage, audio timing and parallel rendering.

Run `npm run test:integration` with ffmpeg, ffprobe and Playwright's Chromium headless shell installed. The normal
unit suite skips browser tests; CI runs them explicitly. To intentionally regenerate `ui.png`, run
`SMASHCUT_UPDATE_GOLDENS=1 npm run test:integration`, then inspect the image and review its diff. Normal test runs
never update the baseline. The comparator permits 0.5% of pixels to differ by more than 12 color levels to account
for small rasterizer differences.
