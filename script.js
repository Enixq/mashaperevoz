const menuButton = document.querySelector('.menu-button');
const mobileNav = document.querySelector('.mobile-nav');
const requestForm = document.querySelector('.form');
const fileInput = document.querySelector('.file input');
const fileLabel = document.querySelector('.file span');

const apiError = (response, body) => {
  if (body?.error) return body.error;
  if (response.status === 401) return 'Доступ к админке закрыт. Введите логин и пароль.';
  if (!response.headers.get('content-type')?.includes('application/json')) return 'Сайт открыт не через Node-сервер. Запустите npm start или настройте Nginx на VPS.';
  return 'Сервер не смог обработать запрос. Попробуйте ещё раз.';
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  let body = null;
  if (contentType.includes('application/json') && raw) {
    try { body = JSON.parse(raw); } catch { throw new Error('API вернул некорректный JSON.'); }
  }
  if (!response.ok) throw new Error(apiError(response, body));
  return body;
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Фото должно быть не больше 8 МБ.'));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
    reader.readAsDataURL(file);
  });
}

menuButton?.addEventListener('click', () => {
  const open = mobileNav?.classList.toggle('open') ?? false;
  menuButton.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => {
  mobileNav?.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

fileInput?.addEventListener('change', () => {
  fileLabel.textContent = fileInput.files?.[0] ? `Фото: ${fileInput.files[0].name}` : '+ Прикрепить фото';
});

requestForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!requestForm.reportValidity()) return;
  const button = requestForm.querySelector('button[type="submit"]');
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Отправляем…';
  try {
    const values = Object.fromEntries(new FormData(requestForm).entries());
    values.photo = await readPhoto(fileInput?.files?.[0]);
    await requestJson('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    requestForm.reset();
    fileLabel.textContent = '+ Прикрепить фото';
    button.textContent = 'Заявка отправлена';
    window.setTimeout(() => { button.disabled = false; button.innerHTML = original; }, 2800);
  } catch (error) {
    button.disabled = false;
    button.innerHTML = original;
    alert(error.message || 'Не удалось отправить заявку.');
  }
});

function renderPublicWorks(works) {
  const grid = document.querySelector('.work-grid');
  if (!grid || !Array.isArray(works) || !works.length) return;
  grid.replaceChildren(...works.map((work) => {
    const card = document.createElement('article');
    const image = document.createElement('img');
    image.src = work.imageUrl || 'assets/works/image (1).jpeg';
    image.alt = work.title || 'Работы на участке';
    const title = document.createElement('h3');
    title.textContent = work.title || 'Работы на участке';
    const description = document.createElement('p');
    description.textContent = work.description || '';
    card.append(image, title, description);
    return card;
  }));
}

function applyPublicSettings(settings) {
  if (!settings) return;
  if (settings.title) document.title = `${settings.title} — комплексные работы`;
  document.querySelectorAll('a[href^="tel:"]').forEach((link) => { if (settings.phone) { link.href = `tel:${settings.phone.replace(/[^+\d]/g, '')}`; link.textContent = settings.phone; } });
  document.querySelectorAll('a[href^="mailto:"]').forEach((link) => { if (settings.email) { link.href = `mailto:${settings.email}`; link.textContent = settings.email; } });
}

Promise.all([requestJson('/api/public/works'), requestJson('/api/public/settings')])
  .then(([works, settings]) => { renderPublicWorks(works); applyPublicSettings(settings); })
  .catch(() => { /* Static preview may not have API; the form explains how to launch it. */ });

const revealTargets = document.querySelectorAll('.services-top, .service-card, .about-copy, .about-photo-restored, .works-top, .work-grid article, .process-title, .steps article, .request-grid > *');
revealTargets.forEach((target, index) => {
  target.classList.add('reveal');
  if (index % 5) target.classList.add(`reveal-delay-${index % 5}`);
});

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries, instance) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); instance.unobserve(entry.target); }
  }), { threshold: 0.12 });
  revealTargets.forEach((target) => observer.observe(target));
} else {
  revealTargets.forEach((target) => target.classList.add('is-visible'));
}
