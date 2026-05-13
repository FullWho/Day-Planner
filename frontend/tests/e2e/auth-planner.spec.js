import { expect, test } from '@playwright/test';

function uniqueEmail(prefix = 'user') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

async function register(page, email, password = 'Admin123!') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Регистрация' }).click();
  await page.getByLabel('Имя пользователя').fill('Test User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByText('Расписание дня')).toBeVisible();
}

test.describe('Авторизация', () => {
  test('показывает ошибку при слабом пароле', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Регистрация' }).click();
    await page.getByLabel('Имя пользователя').fill('Test User');
    await page.getByLabel('Email').fill(uniqueEmail('weak'));
    await page.getByLabel('Пароль').fill('weak');
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();

    await expect(page.getByText('Пароль должен содержать минимум 8 символов')).toBeVisible();
  });

  test('регистрирует пользователя и позволяет войти по email', async ({ page }) => {
    const email = uniqueEmail('login');
    await register(page, email);

    await page.getByRole('button', { name: /выйти/i }).click();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Пароль').fill('Admin123!');
    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.getByText('Расписание дня')).toBeVisible();
  });
});

test.describe('Планировщик', () => {
  test('создаёт задачу и отображает её на шкале', async ({ page }) => {
    await register(page, uniqueEmail('task'));

    const title = `E2E задача ${Date.now()}`;
    await page.getByLabel('Название').fill(title);
    await page.getByLabel('Описание').fill('Описание из E2E-теста');
    await page.getByLabel('Время').fill('09:30');
    await page.getByLabel('Часы').fill('0');
    await page.getByLabel('Минуты').fill('30');
    await page.getByLabel('Приоритет').selectOption('high');
    await page.getByRole('button', { name: 'Добавить' }).click();

    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByText('09:30').first()).toBeVisible();
  });

  test('показывает подсказку для задачи короче 5 минут', async ({ page }) => {
    await register(page, uniqueEmail('duration'));

    await page.getByLabel('Часы').fill('0');
    await page.getByLabel('Минуты').fill('4');

    await expect(page.getByText('Минимальное время для задачи - 5 минут')).toBeVisible();
  });
});
