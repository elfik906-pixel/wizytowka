
// Mały helper
const $ = (sel) => document.querySelector(sel);

/* =========================
   BURGER / NAV
========================= */
const btn = $('.burger');
const links = $('#nav-links');

if (btn && links) {
  btn.addEventListener('click', () => {
    const opened = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!opened));
    links.classList.toggle('open');
    document.body.classList.toggle('nav-open');
  });

  // zamykanie po kliknięciu linku
  links.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      btn.setAttribute('aria-expanded', 'false');
      links.classList.remove('open');
      document.body.classList.remove('nav-open');
    });
  });

  // zamykanie Esc
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && links.classList.contains('open')) {
      btn.setAttribute('aria-expanded', 'false');
      links.classList.remove('open');
      document.body.classList.remove('nav-open');
    }
  });
}

/* =========================
   PANEL "SKÓRKI"
========================= */
const skinsToggle = $('#skins-toggle');
const skinsPanel  = $('#skins-panel');
const closeSkins  = $('.close-skins');

if (skinsToggle && skinsPanel && closeSkins) {
  skinsToggle.addEventListener('click', (e) => {
    e.preventDefault();
    skinsPanel.classList.add('open');
  });

  closeSkins.addEventListener('click', () => {
    skinsPanel.classList.remove('open');
  });

  skinsPanel.addEventListener('click', (e) => {
    if (e.target === skinsPanel) skinsPanel.classList.remove('open');
  });
}

/* =========================
   FORMULARZ + MODAL
========================= */
const form    = $('#contact-form');
const overlay = $('#success-overlay');
const closeBtn= $('#close-success');

function openOverlay() {
  if (!overlay) return;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeOverlay() {
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
  const nameInput = $('#name');
  if (nameInput) nameInput.focus();
}

if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    openOverlay();
    form.reset();
    // zresetuj licznik po wysłaniu
    updateCounter();
  });
}

if (closeBtn)  closeBtn.addEventListener('click', closeOverlay);
if (overlay) {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

/* =========================
   LICZNIK ZNAKÓW (0/500)
========================= */
const msg     = $('#message');
const counter = $('#msg-counter');
// weź limit z atrybutu maxlength, fallback 500
const LIMIT   = msg && msg.maxLength > 0 ? msg.maxLength : 500;

function updateCounter() {
  if (!msg || !counter) return;
  const len = msg.value.length;
  counter.textContent = `${len}/${LIMIT}`;

  counter.classList.remove('warn','danger');
  const ratio = len / LIMIT;
  if (ratio >= 0.95) counter.classList.add('danger');
  else if (ratio >= 0.80) counter.classList.add('warn');
}

if (msg) {
  updateCounter(); // start
  msg.addEventListener('input', updateCounter);
}

// ===== KONSOLOWY ASYSTENT Q&A (z pamięcią localStorage) =====

// 1) Klucz bazy + wczytanie z localStorage
const DB_KEY = "qa_db_v1";
let QA = {};
try {
  QA = JSON.parse(localStorage.getItem(DB_KEY)) || {};
} catch {
  QA = {};
}

// 2) Ustalanie „kontekstu użytkownika” (na bazie wcześniejszego userName z prompt)
const ACTIVE_USER = (typeof userName === "string" && userName.trim()) ? userName.trim() : "guest";

// 3) Funkcja pomocnicza – zapisz bazę
function saveQA() {
  localStorage.setItem(DB_KEY, JSON.stringify(QA));
}

// 4) Pobierz/utwórz „notebook” dla aktywnego usera
function getUserNotebook(name) {
  if (!QA[name]) QA[name] = {};
  return QA[name];
}

// 5) Główna funkcja: zapytaj bazę
function ask(question) {
  if (typeof question !== "string" || !question.trim()) {
    console.log("❗ Podaj pytanie jako tekst, np. ask('ulubiony kolor')");
    return;
  }
  const q = question.trim().toLowerCase();
  const book = getUserNotebook(ACTIVE_USER);

  if (book[q]) {
    console.log(`🤖 Odpowiedź (${ACTIVE_USER}):`, book[q]);
    return book[q];
  } else {
    const ans = prompt(`Nie znam odpowiedzi na: "${question}". Jak powinna brzmieć?`);
    if (ans && ans.trim()) {
      book[q] = ans.trim();
      saveQA();
      console.log("✅ Zapisano nową odpowiedź! Teraz już będę pamiętać.");
      return book[q];
    } else {
      console.log("⏹️ Nie zapisano (pusta odpowiedź).");
      return null;
    }
  }
}

// 6) Mini-menu pomocy dla Q&A
function pomocQA() {
  console.log("🧠 Q&A (per użytkownik):", ACTIVE_USER);
  console.log("👉 ask('pytanie') – zapyta bazę, zapamięta nieznane");
  console.log("👉 showQA()       – pokaż wszystkie zapamiętane odpowiedzi dla użytkownika");
  console.log("👉 resetQA()      – wyczyść pamięć TYLKO dla tego użytkownika");
  console.log("👉 resetAllQA()   – wyczyść CAŁĄ bazę (wszyscy użytkownicy)");
}

// 7) Narzędzia
function showQA() {
  const book = getUserNotebook(ACTIVE_USER);
  if (Object.keys(book).length === 0) {
    console.log("📭 Brak zapisanych odpowiedzi dla:", ACTIVE_USER);
  } else {
    console.table(book);
  }
}
function resetQA() {
  delete QA[ACTIVE_USER];
  saveQA();
  console.log("🧹 Wyczyszczono odpowiedzi dla:", ACTIVE_USER);
}
function resetAllQA() {
  QA = {};
  saveQA();
  console.log("🧨 Wyczyszczono CAŁĄ bazę Q&A.");
}

// 8) Auto-wypisanie pomocy
pomocQA();
