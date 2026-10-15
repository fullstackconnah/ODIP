import { readFileSync } from 'node:fs';
import { test, expect } from '../../support/fixtures';
import { DEMO_TENANT_ID, SEEDED } from '../../support/env';
import { readZipEntry, zipEntryNames } from '../../support/zip';

test.use({ role: SEEDED.superAdmin });

/** RFC 4180 records of a UTF-8 CSV with a BOM: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { record.push(field); field = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { record.push(field); records.push(record); record = []; field = ''; i++; }
    else field += c;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

test('a full export downloads as a ZIP whose manifest counts every file, and the tab then names who exported @export', async ({ page, browser, session }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/settings?tab=export');
  await expect(page.getByRole('heading', { level: 3, name: 'Export all your data' })).toBeVisible();

  const downloading = page.waitForEvent('download', { timeout: 30_000 }); // fires only once the whole export is in, past the 10 s action timeout
  await page.getByRole('button', { name: 'Download all data' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^odip-export-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip$/);

  const zip = readFileSync((await download.path())!);
  const names = zipEntryNames(zip);
  expect(names.at(-1)).toBe('manifest.csv');
  const manifest = parseCsv(readZipEntry(zip, 'manifest.csv')!.toString('utf8'));
  expect(manifest[0]).toEqual(['file', 'rows', 'generated_at', 'odip_build']);
  const counts = new Map(manifest.slice(1).map(r => [r[0], Number(r[1])] as const));
  expect(counts.get('participants.csv')).toBeGreaterThan(0); // the Demo seed has participants
  for (const [file, rows] of counts) {
    if (file === 'documents/') expect(names.filter(n => n.startsWith('documents/')).length, file).toBe(rows);
    else expect(parseCsv(readZipEntry(zip, file)!.toString('utf8')).length - 1, file).toBe(rows);
  }
  expect(readZipEntry(zip, 'README.txt')!.toString('utf8')).toContain('NOT INCLUDED');

  await expect(page.getByText('Export saved', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Last exported by System Admin on /)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('export-saved-1440.png'), fullPage: true });

  // Phone with touch: a context of its own, signed in the way the fixture signs in.
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await phoneContext.addInitScript(([token, user, tenant]) => {
    localStorage.setItem('odip_token', token);
    localStorage.setItem('odip_user', user);
    localStorage.setItem('odip_viewing_tenant', tenant);
  }, [session.token, JSON.stringify(session.user), session.tenantId ?? DEMO_TENANT_ID] as const);
  const phone = await phoneContext.newPage();
  await phone.goto(new URL('/settings?tab=export', page.url()).href);
  const button = phone.getByRole('button', { name: 'Download all data' });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
  await expect(phone.getByText(/^Last exported by System Admin on /)).toBeVisible();
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await phone.screenshot({ path: testInfo.outputPath('export-tab-390.png'), fullPage: true });
  await phoneContext.close();
});
