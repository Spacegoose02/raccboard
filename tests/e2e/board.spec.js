import { expect, test } from '@playwright/test';

const USER = 'e2e';
const PASSWORD = 'e2e-test-password';

// The first account on a fresh server becomes the admin; later runs just sign in.
test.beforeAll(async ({ request }) => {
  const status = await (await request.get('/api/auth/status')).json();
  if (status.setupRequired) {
    await request.post('/api/auth/setup', { data: { username: USER, password: PASSWORD, display_name: 'E2E Tester' } });
  }
});

async function signIn(page) {
  await page.goto('/#/login');
  await page.locator('input[autocomplete=username]').fill(USER);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.locator('.topnav')).toBeVisible();
}

test('create a board, list and card, then complete and undo', async ({ page }) => {
  await signIn(page);
  await page.getByText('Create new board', { exact: false }).first().click();
  await page.getByPlaceholder('Board name').fill('E2E board');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/b\//);

  await page.getByText('+ Add another list').click().catch(() => {});
  await page.getByPlaceholder('Enter list name…').fill('Todo');
  await page.keyboard.press('Enter');
  await page.getByText('+ Add a card').first().click();
  await page.getByPlaceholder('Enter a title for this card…').fill('Write e2e tests');
  await page.keyboard.press('Enter');
  const card = page.locator('.card', { hasText: 'Write e2e tests' });
  await expect(card).toBeVisible();

  await card.locator('button.circle').click();
  await expect(card.locator('button.circle.done')).toBeVisible();
  await expect(page.locator('.undo-toast')).toContainText('Completed');
  await page.locator('.undo-toast button').click();
  await expect(card.locator('button.circle.done')).toHaveCount(0);
});

test('command palette finds a card and opens it', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('e2e tests');
  await expect(page.locator('.palette-list li', { hasText: 'Write e2e tests' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/c\//);
});

test('custom fields: add a field in the card, see it on the card face and in List view', async ({ page }) => {
  await signIn(page);
  await page.keyboard.press('Control+k');
  await page.locator('.palette input').fill('e2e tests');
  await page.locator('.palette-list li', { hasText: 'Write e2e tests' }).click();
  await expect(page.locator('.modal')).toBeVisible();

  await page.locator('.custom-fields').getByRole('button', { name: '+ Field' }).click();
  await page.getByPlaceholder('Field name, e.g. Cost').fill('Cost');
  await page.locator('.field-new select').selectOption('number');
  await page.getByRole('button', { name: 'Add field' }).click();
  const input = page.locator('.field-row', { hasText: 'Cost' }).locator('input');
  await input.fill('42');
  await input.press('Enter');
  await expect(page.locator('.field-row', { hasText: 'Cost' }).locator('input')).toHaveValue('42');

  await page.keyboard.press('Escape');
  await expect(page.locator('.card', { hasText: 'Write e2e tests' }).locator('.field-badge')).toHaveText('Cost: 42');
  await page.getByRole('tab', { name: /List/ }).click();
  await expect(page.locator('.card-table th', { hasText: 'Cost' })).toBeVisible();
  await expect(page.locator('.card-table td[data-label="Cost"]').first()).toHaveText('42');
});

test('dependencies and timeline: blocked badge, bars and arrow', async ({ page, request }) => {
  const login = await (await request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })).json();
  const headers = { Authorization: `Bearer ${login.token}` };
  const board = await (await request.post('/api/boards', { headers, data: { name: 'Timeline board' } })).json();
  const list = await (await request.post(`/api/boards/${board.id}/lists`, { headers, data: { name: 'Plan' } })).json();
  const mk = async (title, start_date, due_date) => {
    const c = await (await request.post(`/api/lists/${list.id}/cards`, { headers, data: { title } })).json();
    await request.patch(`/api/cards/${c.id}`, { headers, data: { start_date, due_date } });
    return c;
  };
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const design = await mk('Design', day(0), day(2));
  const build = await mk('Build', day(3), day(6));
  await request.put(`/api/cards/${build.id}/blockers/${design.id}`, { headers });

  await signIn(page);
  await page.goto(`/#/b/${board.id}`);
  await expect(page.locator('.card', { hasText: 'Build' }).getByText('⛔ Blocked')).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.locator('.tl-bar')).toHaveCount(2);
  await expect(page.locator('.tl-dep')).toHaveCount(1);
  await page.locator('.timeline').screenshot({ path: 'test-results/timeline.png' });
  await page.locator('.timeline-label', { hasText: 'Build' }).click();
  await expect(page.locator('.dependencies')).toContainText('Design');
});
