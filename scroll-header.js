// Auto-hide top header on scroll down on mobile and sync header height CSS variable
(function() {
  let lastScrollY = window.scrollY;
  const header = document.querySelector(".top-header");
  if (!header) return;

  function updateHeaderHeightVar() {
    if (header) {
      const h = header.offsetHeight;
      if (h > 0) {
        document.documentElement.style.setProperty("--header-height", `${h}px`);
      }
    }
  }

  window.addEventListener("scroll", () => {
    if (window.innerWidth > 768) {
      header.style.transform = "translateY(0)";
      return;
    }
    const currentScrollY = window.scrollY;
    if (currentScrollY > 60 && currentScrollY > lastScrollY + 5) {
      // scrolling down: hide header
      header.style.transform = "translateY(-100%)";
    } else if (currentScrollY < lastScrollY - 5 || currentScrollY <= 20) {
      // scrolling up: show header
      header.style.transform = "translateY(0)";
    }
    lastScrollY = currentScrollY;
  }, { passive: true });

  window.addEventListener("resize", updateHeaderHeightVar, { passive: true });
  window.addEventListener("load", updateHeaderHeightVar, { passive: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateHeaderHeightVar);
  } else {
    updateHeaderHeightVar();
  }
})();
