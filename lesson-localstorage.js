// ===== Mini-Notatnik v2 (LocalStorage) =====
const NOTES_KEY = "notes_v2";

// pomocnicze
const getNotes = () => JSON.parse(localStorage.getItem(NOTES_KEY)) || [];
const setNotes = (arr) => localStorage.setItem(NOTES_KEY, JSON.stringify(arr));

function saveNote(text) {
  if (!text || !text.trim()) {
    console.log("❗ Podaj treść notatki, np. saveNote('Pierwsza notatka')");
    return;
  }
  const notes = getNotes();
  notes.push({ text: text.trim(), createdAt: new Date().toISOString() });
  setNotes(notes);
  console.log("✅ Zapisano notatkę:", text.trim());
}

function showNotes() {
  const notes = getNotes();
  if (notes.length === 0) {
    console.log("📭 Brak notatek.");
    return;
  }
  // ładna tabelka z indeksami
  console.table(
    notes.map((n, i) => ({ index: i, text: n.text, createdAt: n.createdAt }))
  );
}

function clearNotes() {
  localStorage.removeItem(NOTES_KEY);
  console.log("🧹 Notatki wyczyszczone!");
}

// NOWE: usuń i edytuj
function deleteNote(index) {
  const notes = getNotes();
  if (Number.isInteger(index) && index >= 0 && index < notes.length) {
    const [removed] = notes.splice(index, 1);
    setNotes(notes);
    console.log("🗑️ Usunięto:", removed.text);
  } else {
    console.log("❗ Podaj poprawny index, np. deleteNote(0)");
  }
}

function editNote(index, newText) {
  const notes = getNotes();
  if (!newText || !newText.trim()) {
    console.log("❗ Podaj nową treść, np. editNote(0, 'Nowy tekst')");
    return;
  }
  if (Number.isInteger(index) && index >= 0 && index < notes.length) {
    notes[index].text = newText.trim();
    notes[index].editedAt = new Date().toISOString();
    setNotes(notes);
    console.log("✏️ Zmieniono notatkę #", index);
  } else {
    console.log("❗ Podaj poprawny index, np. editNote(0, 'Nowy tekst')");
  }
}

// ściąga w konsoli
function notesHelp() {
  console.log("🗒️ Notatnik – komendy:");
  console.log("👉 saveNote('tekst')");
  console.log("👉 showNotes()");
  console.log("👉 editNote(index, 'nowy tekst')");
  console.log("👉 deleteNote(index)");
  console.log("👉 clearNotes()");
}

// pokaż pomoc od razu
notesHelp();
