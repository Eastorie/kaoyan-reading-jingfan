// Auto-hide top header on scroll down on mobile to maximize reading space
(function() {
  let lastScrollY = window.scrollY;
  const header = document.querySelector('.top-header');
  if (!header) return;

  window.addEventListener('scroll', () => {
    if (window.innerWidth > 768) {
      header.style.transform = 'translateY(0)';
      return;
    }
    const currentScrollY = window.scrollY;
    if (currentScrollY > 60 && currentScrollY > lastScrollY + 5) {
      // scrolling down: hide header
      header.style.transform = 'translateY(-100%)';
    } else if (currentScrollY < lastScrollY - 5 || currentScrollY <= 20) {
      // scrolling up: show header
      header.style.transform = 'translateY(0)';
    }
    lastScrollY = currentScrollY;
  }, { passive: true });
})();
