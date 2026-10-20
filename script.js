const menuButton = document.querySelector('.menu-button');
const mobileNav = document.querySelector('.mobile-nav');
const fileInput = document.querySelector('.file input');
const fileLabel = document.querySelector('.file span');

menuButton?.addEventListener('click', () => {
  const open = mobileNav?.classList.toggle('open') ?? false;
  menuButton?.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => {
  mobileNav?.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

fileInput?.addEventListener('change', () => {
  if (fileLabel) fileLabel.textContent = fileInput.files?.[0] ? `Фото: ${fileInput.files[0].name}` : '+ Прикрепить фото';
});
