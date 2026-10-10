import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { onRequest as admin } from '../functions/api/admin/[[path]].js';
import { onRequestGet as publicGames } from '../functions/api/games.js';
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.url)('miniflare');

test('admins edit published game content without changing ownership, visibility or moderation', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'admin-edit-test', modules: true, script: 'export default {fetch(){return new Response("test")}}', d1Databases: { DB: 'admin-edit' }, compatibilityDate: '2026-10-08' }));
  try {
    const DB = await mf.getD1Database('DB');
    await DB.exec(await readFile(new URL('./fixtures/schema.sql', import.meta.url), 'utf8'));
    await DB.exec("INSERT INTO accounts(id,email,role,status) VALUES(1,'admin@example.com','partner','verified'),(2,'developer@example.com','developer','verified'); INSERT INTO developer_profiles(account_id,studio_name,contact_email) VALUES(2,'Account Studio','developer@example.com'); INSERT INTO games(id,slug,t_en,t_zh,full_en,full_zh,developer,studio_logo,genres,platforms,needs,screenshots,claimed_by,contact,status,visible,featured,feature_state,sort,feishu_id,review_note) VALUES(1,'original-abcdef','Original','原名','Original overview','旧中文','Official Studio','preset:team','[\"Adventure\"]','[\"PC\"]','[\"Seeking Publisher\"]','[\"https://example.com/old.png\"]',2,'developer@example.com','approved',1,1,'featured',7,'legacy-record','Approved note'); INSERT INTO games(id,slug,t_ko,status,visible) VALUES(2,'korean-abcdef','한국어 이름','approved',1); INSERT INTO games(id,slug,t_en,status,visible) VALUES(3,'pending-abcdef','Pending','pending',0);");
    const secret = 'local-edit-test-only';
    const cookie = email => {
      const body = Buffer.from(JSON.stringify({ aid: email === 'admin@example.com' ? 1 : 2, email, exp: Date.now() + 60000 })).toString('base64url');
      return 'sry_session=' + body + '.' + createHmac('sha256', secret).update(body).digest('hex');
    };
    const env = { DB, SESSION_SECRET: secret, ADMIN_EMAILS: 'admin@example.com' };
    const call = (path, data, email = 'admin@example.com', bindings = env) => admin({ env: bindings, params: { path: [path.split('?')[0]] }, request: new Request('https://test.example/api/admin/' + path, { method: data ? 'POST' : 'GET', headers: { ...(email ? { cookie: cookie(email) } : {}), ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined }) });
    const row = () => DB.prepare('SELECT * FROM games WHERE id=1').first();
    const original = await row();
    const profile = await DB.prepare('SELECT * FROM developer_profiles WHERE account_id=2').first();
    const detail = await (await call('game?id=1')).json();
    assert.equal(detail.row.developer, 'Official Studio');
    assert.equal(detail.row.studio_logo, 'preset:team');
    const changes = { t_en: 'Renamed', full_en: 'A new brief.\n\n- A specific feature.', full_zh: '', developer: 'Steam Official Studio', stage: 'Demo', genres: ['Adventure', 'Action'], screenshots: ['https://example.com/new.png'], cover: 'https://example.com/cover.png', studio_en: 'An independent team.', studio_logo: 'preset:studio' };
    const expected = Object.fromEntries(Object.keys(changes).map(key => [key, Array.isArray(changes[key]) ? JSON.parse(original[key] || '[]') : original[key] || '']));
    const payload = { id: 1, changes, expected };
    assert.equal((await call('game-update', payload, null)).status, 401);
    assert.equal((await call('game-update', payload, 'developer@example.com')).status, 403);
    assert.deepEqual(await row(), original);
    const response = await call('game-update', payload);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).updated, changes);
    const edited = await row();
    for (const [key, value] of Object.entries(original)) {
      assert.deepEqual(edited[key], key in changes ? (Array.isArray(changes[key]) ? JSON.stringify(changes[key]) : changes[key]) : value, 'Unexpected change to ' + key);
    }
    assert.deepEqual(await DB.prepare('SELECT * FROM developer_profiles WHERE account_id=2').first(), profile);
    const publicResponse = await publicGames({ env });
    assert.equal(publicResponse.headers.get('cache-control'), 'no-cache');
    const published = await publicResponse.json();
    assert.equal(published.length, 2); // Korean-only titles are still visible; the pending game is not.
    assert.equal(published.find(game => game.id === 1).full_en, changes.full_en);
    assert.equal(published.find(game => game.id === 1).slug, original.slug);
    assert.equal('contact' in published[0], false);

    assert.equal((await call('game-update', payload)).status, 409);
    assert.deepEqual(await row(), edited);
    assert.equal((await call('game-update', { id: 1, changes: { status: 'pending' }, expected: { status: 'approved' } })).status, 400);
    assert.equal((await call('game-update', { id: 1, changes: { developer: 'New' }, expected: {} })).status, 400);
    assert.equal((await call('game-update', { id: '1x', changes: {}, expected: {} })).status, 400);
    assert.equal((await call('game-update', { id: 999, changes: { developer: 'New' }, expected: { developer: '' } })).status, 404);
    assert.equal((await call('game-update', { id: 1, changes: { t_en: '', t_zh: '', t_ko: '' }, expected: { t_en: 'Renamed', t_zh: '原名', t_ko: '' } })).status, 400);
    assert.equal((await call('game-update', { id: 1, changes: { screenshots: ['javascript:alert(1)'] }, expected: { screenshots: changes.screenshots } })).status, 400);
    assert.equal((await call('game-update', { id: 1, changes: { full_en: 'x'.repeat(10001) }, expected: { full_en: changes.full_en } })).status, 400);
    assert.equal((await call('game-update', { id: 1, changes: { stage: 'Invalid' }, expected: { stage: 'Demo' } })).status, 400);
    assert.deepEqual(await row(), edited);

    // A save that lands after validation is caught by the atomic UPDATE condition.
    let raced = false;
    const racingDB = { prepare(sql) {
      const prepared = DB.prepare(sql);
      if (!sql.startsWith('UPDATE games SET')) return prepared;
      return { bind(...values) {
        const bound = prepared.bind(...values);
        return { async run() {
          if (!raced) { raced = true; await DB.prepare('UPDATE games SET developer=? WHERE id=1').bind('Concurrent Studio').run(); }
          return bound.run();
        } };
      } };
    } };
    const conflict = await call('game-update', { id: 1, changes: { developer: 'Stale Studio' }, expected: { developer: changes.developer } }, 'admin@example.com', { ...env, DB: racingDB });
    assert.equal(conflict.status, 409);
    assert.equal((await row()).developer, 'Concurrent Studio');
    // Editing another field does not overwrite the concurrent developer edit.
    assert.equal((await call('game-update', { id: 1, changes: { d_en: 'A new pitch.' }, expected: { d_en: '' } })).status, 200);
    assert.equal((await row()).developer, 'Concurrent Studio');
    // A pending game's content can also be edited without publishing it.
    assert.equal((await call('game-update', { id: 3, changes: { full_en: 'Pending brief' }, expected: { full_en: '' } })).status, 200);
    assert.deepEqual(await DB.prepare('SELECT status,visible FROM games WHERE id=3').first(), { status: 'pending', visible: 0 });
    // Older admin tabs still use the i18n endpoint; their longer overview is not truncated.
    const longOverview='A'.repeat(3000);
    const i18n=await call('game-i18n',{id:3,t_en:'Pending',full_en:longOverview});
    assert.equal(i18n.status,200);
    assert.equal((await DB.prepare('SELECT full_en FROM games WHERE id=3').first()).full_en,longOverview);
  } finally { await mf.dispose(); }
});
