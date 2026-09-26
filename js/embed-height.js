// Pri vložení cez <iframe> (napr. na WordPress stránku) posiela stránka rodičovi
// svoju výšku, aby sa iframe natiahol bez vnútorného posúvania, a pri odkazoch
// na časť stránky (#ciele…) požiada rodiča o posun na správne miesto.
// Mimo iframe nerobí nič.
(function () {
  if (window.parent === window) return;

  // Výška obsahu (nie okna), aby sa iframe vedel aj zmenšiť po prechode na kratšiu stránku.
  const contentHeight = () => Math.ceil(document.body.getBoundingClientRect().height);
  let last = 0;
  const postHeight = () => {
    const h = contentHeight();
    if (h !== last) {
      last = h;
      window.parent.postMessage({ type: "financny-plan:height", height: h }, "*");
    }
  };
  const scrollParentTo = (el) => {
    window.parent.postMessage({ type: "financny-plan:scroll", top: Math.round(el.getBoundingClientRect().top + window.scrollY) }, "*");
  };

  function start() {
    new ResizeObserver(postHeight).observe(document.body);
    // Poistka: v iframe z inej domény prehliadač niekedy ResizeObserver nespustí.
    // Kontrola je lacná a správa sa pošle len pri zmene výšky.
    setInterval(postHeight, 600);
    postHeight();
    // Kotvy v rámci stránky posúvajú rodiča (iframe sám nemá posuvník).
    document.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      const el = a && document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
      if (!el) return;
      e.preventDefault();
      scrollParentTo(el);
    });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  window.addEventListener("load", () => {
    postHeight();
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) setTimeout(() => scrollParentTo(target), 50);
  });
})();
