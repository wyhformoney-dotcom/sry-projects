const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const base = process.env.DETAIL_BASE_URL || 'http://127.0.0.1:8811';
const image = i => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#345675"/><text x="100" y="270" fill="white" font-size="80">Screenshot ${i}</text></svg>`);
const game = {
  id: 1, t_en: 'Layout Test', t_zh: '布局测试', t_ko: '레이아웃 테스트',
  d_en: 'An adventure across distinctive worlds.', d_zh: '穿越独特世界的冒险。', d_ko: '독특한 세계를 탐험하는 모험.',
  full_en: 'A concise project introduction for publishers.\n\n- Explore distinctive regions.\n- Shape your approach to combat.\n- Build and improve a stronghold.',
  full_zh: '面向发行商的简短项目介绍。\n\n- 探索各具特色的区域。\n- 自由选择战斗方式。\n- 建造并升级据点。',
  full_ko: '퍼블리셔를 위한 간결한 프로젝트 소개.\n\n- 다양한 지역 탐험.\n- 자유로운 전투 방식.\n- 거점 건설과 개선.',
  developer: 'AStudioWithAnEspeciallyLongUnbrokenOfficialDeveloperName',
  studio_en: 'An independent team creating distinctive adventures.',
  studio_zh: '致力于打造独特冒险体验的独立团队。', studio_ko: '독특한 모험을 만드는 독립 개발팀.',
  studioLogo: 'preset:team', stage: 'In Development', genres: ['Action', 'Adventure'],
  needs: ['Seeking Publisher', 'Seeking Investment'], platforms: ['PC', 'Console'], region: 'Global',
  video: '/layout-test.mp4', cover: image(0), screenshots: Array.from({ length: 12 }, (_, i) => image(i + 1)),
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.**', route => route.abort());
    await page.route('**/layout-test.mp4', route => route.fulfill({ contentType: 'video/mp4', body: '' }));
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      return route.fulfill({ json: pathname === '/api/games' ? [game] : pathname === '/api/auth/me' ? { loggedIn: true, role: 'developer', status: 'verified', email: 'long.account.name@example.com' } : { ok: true, ids: [] } });
    });
    await page.goto(base + '/game.html?id=layout-test');
    await page.locator('.overview li').first().waitFor();
    await page.waitForFunction(() => document.querySelector('#acct').textContent.includes('long.account'));

    for (const width of [1440, 1024, 860, 768, 600, 560, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const language of ['en', 'zh', 'ko']) {
        await page.locator(`#lang [data-l="${language}"]`).click();
        const layout = await page.evaluate(() => {
          const rect = selector => {
            const r = document.querySelector(selector).getBoundingClientRect();
            return { left: r.left, right: r.right, width: r.width, height: r.height };
          };
          const thumbs = document.querySelector('.thumbs');
          const nav = document.querySelector('.nav').getBoundingClientRect();
          return {
            viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
            modules: ['.media', '.dealsheet', '.tracker', '.overview', '.studio', '.cta-band'].map(rect),
            headings: Array.from(document.querySelectorAll('.section-h'), el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }),
            body: rect('.overview .game-description'), stage: rect('.stage-main'),
            thumbTops: Array.from(thumbs.children, el => el.getBoundingClientRect().top),
            stripWidth: thumbs.clientWidth, stripContentWidth: thumbs.scrollWidth,
            navigationFits: ['.brand', '#lang', '#acct'].every(selector => {
              const r = document.querySelector(selector).getBoundingClientRect();
              return r.left >= nav.left && r.right <= nav.right && r.top >= nav.top && r.bottom <= nav.bottom;
            }),
            stageLabelsFit: Array.from(document.querySelectorAll('.tk-seg'), el => el.scrollWidth <= el.clientWidth),
          };
        });
        const reference = layout.modules[1];
        assert.ok(layout.pageWidth <= layout.viewport, `${width}/${language}: page overflows by ${layout.pageWidth - layout.viewport}px`);
        assert.ok(layout.navigationFits, `${width}/${language}: navigation controls do not fit`);
        assert.ok(layout.stageLabelsFit.every(Boolean), `${width}/${language}: stage labels overlap`);
        for (const module of [...layout.modules, ...layout.headings]) {
          assert.ok(Math.abs(module.left - reference.left) < 1 && Math.abs(module.right - reference.right) < 1, `${width}/${language}: module boundaries do not align`);
        }
        assert.ok(Math.abs(layout.stage.width / layout.stage.height - 16 / 9) < .01, `${width}/${language}: media ratio`);
        assert.ok(layout.thumbTops.every(top => Math.abs(top - layout.thumbTops[0]) < 1), `${width}/${language}: thumbnails wrap`);
        assert.ok(layout.stripContentWidth > layout.stripWidth, `${width}/${language}: gallery should scroll internally`);
        assert.ok(layout.body.left > reference.left && layout.body.right < reference.right, `${width}/${language}: text stays inside its panel`);
        if (width >= 1024) assert.ok(layout.body.width < reference.width * .85, `${width}/${language}: reading lines too wide`);
      }
    }

    // Keyboard focus scrolls to a thumbnail; Enter selects it without navigating.
    const last = page.locator('.thumb').last();
    await last.focus();
    await page.keyboard.press('Enter');
    assert.equal(await last.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.thumb[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('#mainview img').getAttribute('src'), game.screenshots.at(-1));
    assert.ok(await page.locator('.thumbs').evaluate(el => el.scrollLeft > 0));
    await page.locator('.thumb').first().focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('.thumb').first().getAttribute('aria-pressed'), 'true');
    await page.locator('#pb').click();
    assert.equal(await page.locator('#mainview video').count(), 1);

    // Optional sections and a single-image gallery remain valid.
    await page.evaluate(() => {
      GAME = { ...GAME, developer: '', studio_en: '', studio_zh: '', studio_ko: '', full_en: '', full_zh: '', full_ko: '', stage: '', video: '', screenshots: [] };
      media = buildMedia(GAME); activeIdx = 0; playing = false; render();
    });
    assert.equal(await page.locator('.overview,.studio,.tracker,.thumbs').count(), 0);
    assert.equal(await page.locator('#mainview img').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('PASS: aligned detail modules, readable text, 16:9 media, scrolling keyboard gallery and optional sections at eight widths in three languages');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
