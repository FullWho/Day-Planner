import { test, expect } from '@playwright/test';

const strongPassword = 'Admin123!';

function uniqueEmail(prefix = 'user') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}@example.com`;
}

async function fillRegistrationForm(page, email, password = strongPassword) {
  await page.getByRole('button', { name: 'Регистрация' }).click();

  await page.getByLabel('Имя пользователя').fill('Test User');
  await page.getByLabel('Email').fill(email);

  // В форме регистрации поле пароля имеет placeholder "Минимум 8 символов".
  // Через getByLabel('Пароль') выбирать нельзя, потому что рядом есть кнопка "Показать пароль".
  await page.getByPlaceholder('Минимум 8 символов').fill(password);
}

async function register(page, email, password = strongPassword) {
  await page.goto('/');

  await fillRegistrationForm(page, email, password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();

  await expect(page.getByText('Расписание дня')).toBeVisible();
}

async function logout(page) {
  const logoutButton = page
    .getByRole('button')
    .filter({ has: page.locator('svg') })
    .last();

  await logoutButton.click();
}

async function login(page, email, password = strongPassword) {
  await page.goto('/');

  await page.getByRole('button', { name: 'Вход' }).click();
  await page.getByLabel('Email').fill(email);

  // На форме входа подсказок нет, поэтому выбираем первое password-поле.
  await page.locator('input[type="password"]').first().fill(password);

  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page.getByText('Расписание дня')).toBeVisible();
}

test.describe('Авторизация', () => {
  test('показывает ошибку при слабом пароле', async ({ page }) => {
    await page.goto('/');

    await fillRegistrationForm(page, uniqueEmail('weak'), 'weak');
    await page.getByRole('button', { name: 'Создать аккаунт' }).click();

    await expect(
      page.getByText(/Пароль должен содержать минимум 8 символов/i)
    ).toBeVisible();
  });

  test('регистрирует пользователя и позволяет войти по email', async ({ page }) => {
    const email = uniqueEmail('login');

    await register(page, email);

    await logout(page);

    await login(page, email);

    await expect(page.getByText('Расписание дня')).toBeVisible();
  });
});

test.describe('Планировщик', () => {
  test('создаёт задачу и отображает её на шкале', async ({ page }) => {
    const email = uniqueEmail('task');

    await register(page, email);

    await page.getByLabel('Название').fill('E2E задача');
    await page.getByLabel('Описание').fill('Создано автотестом');
    await page.getByLabel('Время').fill('09:00');
    await page.getByLabel('Часы').fill('1');
    await page.getByLabel('Минуты').fill('0');

    await page.getByRole('button', { name: 'Добавить' }).click();

    await expect(page.getByText('E2E задача').first()).toBeVisible();
    await expect(page.getByText(/09:00/).first()).toBeVisible();
  });

  test('показывает подсказку для задачи короче 5 минут', async ({ page }) => {
    const email = uniqueEmail('short');

    await register(page, email);

    await page.getByLabel('Название').fill('Слишком короткая задача');
    await page.getByLabel('Время').fill('10:00');
    await page.getByLabel('Часы').fill('0');
    await page.getByLabel('Минуты').fill('4');

    await page.getByRole('button', { name: 'Добавить' }).click();

    await expect(
      page.getByText('Минимальное время для задачи - 5 минут')
    ).toBeVisible();
  });
});
