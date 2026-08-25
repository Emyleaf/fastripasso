const SOURCE_FILES = [
  "Diritto ed Economia - Primo anno.md",
  "Diritto ed Economia - Secondo anno.md",
  "Scienze Umane - Primo anno.md",
  "Scienze Umane - Secondo anno.md"
];

const state = {
  topics: [],
  cards: [],
  queue: [],
  current: 0,
  subject: "all",
  year: "all",
  selectedCategories: new Set(),
  categorySearch: "",
  theorySearch: "",
  revealed: false,
  mastered: new Set(),
  needsReview: new Set(),
  activeTheory: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  try {
    const files = await Promise.all(SOURCE_FILES.map(async (file) => {
      const response = await fetch(encodeURI(file));
      if (!response.ok) throw new Error(`Impossibile leggere ${file}`);
      return { file, text: await response.text() };
    }));
    state.topics = files.flatMap(({ file, text }) => parseDocument(text, file));
    state.cards = state.topics.flatMap(makeCardsForTopic);
    updateStats();
    renderCategoryList();
    buildQueue();
    renderTheoryList();
    if (state.topics[0]) selectTheory(state.topics[0].id);
  } catch (error) {
    showLoadingError(error);
  }
}

function bindEvents() {
  $("#subject-filter").addEventListener("change", (event) => {
    state.subject = event.target.value;
    resetCategorySelection();
    refreshFilters();
  });
  $("#year-filter").addEventListener("change", (event) => {
    state.year = event.target.value;
    resetCategorySelection();
    refreshFilters();
  });
  $("#category-search").addEventListener("input", (event) => {
    state.categorySearch = event.target.value.trim().toLowerCase();
    renderCategoryList();
  });
  $("#theory-search").addEventListener("input", (event) => {
    state.theorySearch = event.target.value.trim().toLowerCase();
    renderTheoryList();
  });
  $("#toggle-all-topics").addEventListener("click", () => {
    const available = getFilteredTopics();
    const allSelected = available.length > 0 && available.every((topic) => state.selectedCategories.has(topic.id));
    available.forEach((topic) => allSelected ? state.selectedCategories.delete(topic.id) : state.selectedCategories.add(topic.id));
    refreshFilters();
  });
  $("#reset-filters").addEventListener("click", () => {
    state.subject = "all";
    state.year = "all";
    state.selectedCategories.clear();
    $("#subject-filter").value = "all";
    $("#year-filter").value = "all";
    refreshFilters();
  });
  $("#new-session").addEventListener("click", () => buildQueue(true));
  $("#flashcard").addEventListener("click", toggleCard);
  $("#next-card").addEventListener("click", (event) => { event.stopPropagation(); nextCard(false); });
  $("#review-card").addEventListener("click", (event) => { event.stopPropagation(); nextCard(true); });
  $("#flashcard").addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggleCard(); }
  });
  document.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (event.key === "ArrowRight") nextCard(false);
    if (event.key === "ArrowLeft") nextCard(true);
  });
  $$(".view-tab").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
}

function parseDocument(markdown, fileName) {
  const subject = fileName.startsWith("Scienze") ? "Scienze Umane" : "Diritto ed Economia";
  const year = fileName.includes("Primo") ? "1" : "2";
  const lines = markdown.replace(/\r/g, "").split("\n");
  const topics = [];
  let area = subject === "Scienze Umane" ? "Scienze Umane" : "Diritto";
  let current = null;

  lines.forEach((line) => {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h1) {
      const title = stripMarkdown(h1[1]);
      if (subject === "Diritto ed Economia") {
        const rawArea = title.split(" - ")[0].trim().toLowerCase();
        area = rawArea.charAt(0).toUpperCase() + rawArea.slice(1);
      }
      return;
    }
    if (h2) {
      current = {
        id: slug(`${fileName}-${area}-${h2[1]}`),
        subject,
        year,
        area,
        title: stripMarkdown(h2[1]),
        category: `${area} · ${stripMarkdown(h2[1])}`,
        lines: []
      };
      topics.push(current);
      return;
    }
    if (current) current.lines.push(line);
  });
  return topics.map((topic) => ({ ...topic, markdown: topic.lines.join("\n").trim() }));
}

function makeCardsForTopic(topic) {
  const cards = [];
  const blocks = topic.markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const firstParagraph = blocks.find((block) => !/^###\s/.test(block) && !/^-\s/.test(block));
  if (firstParagraph) {
    cards.push(createCard(topic, `Spiega l'argomento: ${topic.title}`, compactAnswer(topic.markdown), "topic"));
  }

  const definitionPattern = /\*\*([^*]+)\*\*\s+(?:è|sono|si definisce|si definiscono|indica|indicano|rappresenta|rappresentano|consiste|consistono|significa|si distinguono)/gi;
  const seenTerms = new Set();
  blocks.forEach((block) => {
    if (/^###\s/.test(block) || /^-\s/.test(block)) return;
    let match;
    while ((match = definitionPattern.exec(block)) && seenTerms.size < 4) {
      const term = stripMarkdown(match[1]).trim();
      const key = term.toLowerCase();
      if (!seenTerms.has(key) && term.length > 2 && term.length < 80) {
        const answer = block.replace(/^###.*\n?/, "").trim();
        cards.push(createCard(topic, `Che cos'è ${term}?`, answer, "definition"));
        seenTerms.add(key);
      }
    }
  });

  const subtopics = topic.markdown.split(/(?=^###\s)/m).filter((part) => /^###\s/.test(part.trim()));
  subtopics.slice(0, 4).forEach((part) => {
    const lines = part.trim().split("\n");
    const title = stripMarkdown(lines.shift().replace(/^###\s+/, "").trim());
    const answer = lines.join("\n").trim();
    if (answer) cards.push(createCard(topic, `Spiega: ${title}`, answer, "subtopic"));
  });
  return cards;
}

function createCard(topic, question, answer, type) {
  return { id: `${topic.id}-${type}-${slug(question)}`, topicId: topic.id, subject: topic.subject, year: topic.year, area: topic.area, category: topic.category, question, answer };
}

function getFilteredTopics() {
  return state.topics.filter((topic) => {
    const subjectOk = state.subject === "all" || topic.subject === state.subject;
    const yearOk = state.year === "all" || topic.year === state.year;
    const categoryOk = state.selectedCategories.size === 0 || state.selectedCategories.has(topic.id);
    return subjectOk && yearOk && categoryOk;
  });
}

function getAvailableTopics() {
  return state.topics.filter((topic) => {
    const subjectOk = state.subject === "all" || topic.subject === state.subject;
    const yearOk = state.year === "all" || topic.year === state.year;
    return subjectOk && yearOk;
  });
}

function buildQueue(forceShuffle = false) {
  const topics = getFilteredTopics();
  const topicIds = new Set(topics.map((topic) => topic.id));
  let cards = state.cards.filter((card) => topicIds.has(card.topicId));
  if (forceShuffle || !state.queue.length) cards = shuffle(cards);
  else cards = state.queue.filter((card) => topicIds.has(card.topicId));
  state.queue = cards;
  state.current = 0;
  state.revealed = false;
  renderCard();
  updateStats();
}

function nextCard(markForReview) {
  const card = state.queue[state.current];
  if (!card) return;
  if (markForReview) state.needsReview.add(card.id);
  else state.mastered.add(card.id);
  if (state.current < state.queue.length - 1) {
    state.current += 1;
    state.revealed = false;
    renderCard();
  } else {
    state.revealed = false;
    renderCard(true);
  }
  updateStats();
}

function renderCard(finished = false) {
  const card = state.queue[state.current];
  const flashcard = $("#flashcard");
  const empty = $("#empty-state");
  const actions = $("#card-actions");
  if (!card || finished) {
    flashcard.hidden = true;
    actions.hidden = true;
    empty.hidden = false;
    empty.querySelector("h3").textContent = finished ? "Sessione completata!" : "Nessuna carta qui, per ora.";
    empty.querySelector("p").textContent = finished ? "Hai attraversato tutte le carte selezionate. Puoi ripartire con una nuova sessione." : "Seleziona almeno una macrocategoria oppure cambia i filtri per iniziare.";
    $("#card-counter").textContent = finished ? `${state.queue.length} / ${state.queue.length}` : "— / —";
    return;
  }
  empty.hidden = true;
  flashcard.hidden = false;
  actions.hidden = false;
  flashcard.classList.toggle("is-flipped", state.revealed);
  flashcard.querySelector(".card-back").setAttribute("aria-hidden", String(!state.revealed));
  $("#card-area").textContent = card.area.toUpperCase();
  $("#card-year").textContent = card.year === "1" ? "1° ANNO" : "2° ANNO";
  $("#card-question").textContent = card.question;
  $("#card-category").textContent = card.category;
  $("#answer-category").textContent = card.category;
  $("#card-answer").innerHTML = renderMarkdown(card.answer);
  $("#card-counter").textContent = `${state.current + 1} / ${state.queue.length}`;
  $("#session-label").textContent = `${getFilteredTopics().length} argomenti selezionati`;
}

function toggleCard() {
  if (!state.queue[state.current]) return;
  state.revealed = !state.revealed;
  renderCard();
}

function renderCategoryList() {
  const list = $("#category-list");
  const available = getAvailableTopics().filter((topic) => !state.categorySearch || topic.category.toLowerCase().includes(state.categorySearch));
  if (!available.length) {
    list.innerHTML = `<div class="theory-empty">Nessun argomento corrisponde alla ricerca.</div>`;
    return;
  }
  list.innerHTML = available.map((topic) => `
    <div class="category-item">
      <input type="checkbox" id="topic-${topic.id}" data-topic-id="${topic.id}" ${state.selectedCategories.has(topic.id) ? "checked" : ""}>
      <label for="topic-${topic.id}">${escapeHtml(topic.title)}<span class="category-meta">${escapeHtml(topic.area)} · ${topic.year}° anno</span></label>
    </div>`).join("");
  list.querySelectorAll("input").forEach((input) => input.addEventListener("change", (event) => {
    const id = event.target.dataset.topicId;
    event.target.checked ? state.selectedCategories.add(id) : state.selectedCategories.delete(id);
    buildQueue(true);
  }));
}

function renderTheoryList() {
  const list = $("#theory-topic-list");
  const topics = state.topics.filter((topic) => !state.theorySearch || `${topic.title} ${topic.area} ${topic.subject}`.toLowerCase().includes(state.theorySearch));
  list.innerHTML = topics.length ? topics.map((topic) => `
    <button class="theory-topic-button ${topic.id === state.activeTheory ? "is-active" : ""}" data-theory-id="${topic.id}" type="button">
      <strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.area)} · ${topic.year}° anno</span>
    </button>`).join("") : `<div class="theory-empty">Nessun argomento trovato.</div>`;
  list.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => selectTheory(button.dataset.theoryId)));
}

function selectTheory(id) {
  const topic = state.topics.find((item) => item.id === id);
  if (!topic) return;
  state.activeTheory = id;
  $("#theory-content").innerHTML = `<div class="card-kicker"><span>${escapeHtml(topic.area)}</span><span>${topic.year}° anno · ${escapeHtml(topic.subject)}</span></div><h2>${escapeHtml(topic.title)}</h2>${renderMarkdown(topic.markdown)}`;
  renderTheoryList();
}

function refreshFilters() {
  renderCategoryList();
  buildQueue(true);
}

function resetCategorySelection() {
  state.selectedCategories.clear();
}

function updateStats() {
  $("#total-cards").textContent = state.cards.length || "—";
  $("#mastered-cards").textContent = state.mastered.size;
  $("#study-count").textContent = state.cards.length || "—";
  $("#theory-count").textContent = state.topics.length || "—";
}

function switchView(view) {
  $$(".view-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $("#study-view").hidden = view !== "study";
  $("#theory-view").hidden = view !== "theory";
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let html = "";
  let paragraph = [];
  let list = [];
  const flushParagraph = () => { if (paragraph.length) { html += `<p>${inlineMarkdown(paragraph.join(" "))}</p>`; paragraph = []; } };
  const flushList = () => { if (list.length) { html += `<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`; list = []; } };
  lines.forEach((line) => {
    if (/^\s*$/.test(line)) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^(#{2,3})\s+(.+)/);
    if (heading) { flushParagraph(); flushList(); html += `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`; return; }
    if (/^---+\s*$/.test(line)) { flushParagraph(); flushList(); html += "<hr>"; return; }
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (bullet) { flushParagraph(); list.push(bullet[1]); return; }
    const quote = line.match(/^>\s*(.*)/);
    if (quote) { flushParagraph(); flushList(); html += `<blockquote>${inlineMarkdown(quote[1])}</blockquote>`; return; }
    flushList();
    paragraph.push(line.trim());
  });
  flushParagraph(); flushList();
  return html;
}

function inlineMarkdown(value) {
  let safe = escapeHtml(value);
  safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  safe = safe.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  safe = safe.replace(/_([^_]+)_/g, "<em>$1</em>");
  return safe;
}

function compactAnswer(markdown) {
  const blocks = markdown.split(/\n\s*\n/).filter(Boolean);
  const selected = blocks.slice(0, 3).join("\n\n");
  return selected.length > 1150 ? `${selected.slice(0, 1147)}…` : selected;
}

function stripMarkdown(value) { return value.replace(/[*_`]/g, "").trim(); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function slug(value) { return stripMarkdown(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function shuffle(items) { return [...items].sort(() => Math.random() - .5); }

function showLoadingError(error) {
  console.error(error);
  $("#category-list").innerHTML = `<div class="theory-empty">Non riesco a caricare i file di teoria. Se stai aprendo index.html direttamente, avvia la pagina con un piccolo server locale oppure pubblicala su GitHub Pages.</div>`;
  $("#total-cards").textContent = "0";
  $("#study-count").textContent = "0";
  $("#theory-count").textContent = "0";
}

