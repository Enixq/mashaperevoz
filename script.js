const menuButton = document.querySelector('.menu-button');
const mobileNav = document.querySelector('.mobile-nav');
const fileInput = document.querySelector('.file input');
const fileLabel = document.querySelector('.file span');

menuButton?.addEventListener('click', () => {
  const open = mobileNav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.mobile-nav a').forEach((link) => link.addEventListener('click', () => {
  mobileNav.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

fileInput?.addEventListener('change', () => {
  fileLabel.textContent = fileInput.files?.[0] ? `Фото: ${fileInput.files[0].name}` : '+ Прикрепить фото';
});

const servicesSection = document.querySelector('.services');
const canAnimateServices = servicesSection
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  && window.matchMedia('(min-width: 851px)').matches;

if (canAnimateServices) {
  servicesSection.classList.add('services-animate');
  const servicesObserver = new IntersectionObserver((entries, observer) => {
    if (entries[0].isIntersecting) {
      servicesSection.classList.add('services-animated');
      observer.disconnect();
    }
  }, { threshold: 0.08 });
  servicesObserver.observe(servicesSection);
}

const worksSection = document.querySelector('.works');
const canAnimateWorks = worksSection
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  && window.matchMedia('(min-width: 851px)').matches;

if (canAnimateWorks) {
  worksSection.classList.add('works-animate');
  const worksObserver = new IntersectionObserver((entries, observer) => {
    if (entries[0].isIntersecting) {
      worksSection.classList.add('works-animated');
      observer.disconnect();
    }
  }, { threshold: 0.1 });
  worksObserver.observe(worksSection);
}
