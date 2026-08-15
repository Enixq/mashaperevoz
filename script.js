const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');
const photoInput = document.querySelector('input[type="file"]');
const fileLabel = document.querySelector('.file-input span');

menuToggle?.addEventListener('click', () => {
  const opened = mobileNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(opened));
});

document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => {
  mobileNav.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}));

photoInput?.addEventListener('change', () => {
  fileLabel.textContent = photoInput.files?.[0] ? `✓ ${photoInput.files[0].name}` : '＋ Прикрепить фото';
});
