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
  completed: false,
  studyMode: "free",
  sessionMode: "standard",
  examActive: false,
  examSubject: "Diritto ed Economia",
  examLength: 10,
  mastered: new Set(),
  partial: new Set(),
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
    updateModeUI();
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
    const available = getAvailableTopics();
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
  $("#new-session").addEventListener("click", startNewSession);
  $("#flashcard").addEventListener("click", () => {
    if (suppressCardClick) { suppressCardClick = false; return; }
    toggleCard();
  });
  $("#next-card").addEventListener("click", () => rateCard("mastered"));
  $("#partial-card").addEventListener("click", () => rateCard("partial"));
  $("#review-card").addEventListener("click", () => rateCard("review"));
  $("#previous-card").addEventListener("click", () => goToCard(-1));
  $("#forward-card").addEventListener("click", () => goToCard(1));
  $("#open-card-theory").addEventListener("click", openCurrentTheory);
  $("#review-session").addEventListener("click", buildReviewQueue);
  $("#restart-session").addEventListener("click", startNewSession);
  $("#start-exam").addEventListener("click", startExam);
  $("#review-exam").addEventListener("click", reviewExamMistakes);
  $("#new-exam").addEventListener("click", resetExamSetup);
  $$("[data-study-mode]").forEach((button) => button.addEventListener("click", () => switchStudyMode(button.dataset.studyMode)));
  $("#flashcard").addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); toggleCard(); }
  });
  document.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (event.key === "ArrowRight") goToCard(1);
    if (event.key === "ArrowLeft") goToCard(-1);
  });
  setupCardSwipe();
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
  const firstSubtopicIndex = topic.markdown.search(/^###\s/m);
  const overview = (firstSubtopicIndex >= 0 ? topic.markdown.slice(0, firstSubtopicIndex) : topic.markdown)
    .replace(/\n?---+\s*$/g, "")
    .trim();
  if (overview) cards.push(createCard(topic, topicQuestion(topic.title), overview, "topic"));

  const definitionPattern = /\*\*([^*]+)\*\*\s+(?:è|sono|si definisce|si definiscono|indica|indicano|rappresenta|rappresentano|consiste|consistono|significa|si distinguono)/gi;
  const seenTerms = new Set();
  blocks.forEach((block, blockIndex) => {
    if (/^###\s/.test(block) || /^-\s/.test(block)) return;
    let match;
    while ((match = definitionPattern.exec(block)) && seenTerms.size < 4) {
      const term = stripMarkdown(match[1]).trim();
      const key = term.toLowerCase();
      if (!seenTerms.has(key) && term.length > 2 && term.length < 80) {
        const continuation = [];
        for (let index = blockIndex + 1; index < blocks.length && isListBlock(blocks[index]); index += 1) {
          continuation.push(blocks[index]);
        }
        const answer = [block.replace(/^###.*\n?/, "").trim(), ...continuation].join("\n\n");
        if (answer !== overview) cards.push(createCard(topic, definitionQuestion(term), answer, "definition"));
        seenTerms.add(key);
      }
    }
  });

  const subtopics = topic.markdown.split(/(?=^###\s)/m).filter((part) => /^###\s/.test(part.trim()));
  subtopics.forEach((part) => {
    const lines = part.trim().split("\n");
    const title = stripMarkdown(lines.shift().replace(/^###\s+/, "").trim());
    const answer = lines.join("\n").trim();
    if (answer) cards.push(createCard(topic, topicQuestion(title, topic.title), answer, "subtopic"));
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
  state.completed = false;
  state.sessionMode = "standard";
  renderCard();
  updateStats();
}

function startNewSession() {
  state.mastered.clear();
  state.partial.clear();
  state.needsReview.clear();
  buildQueue(true);
}

function rateCard(result) {
  const card = state.queue[state.current];
  if (!card) return;
  if (state.studyMode === "exam" && !state.revealed) return;
  if (result === "review") {
    state.needsReview.add(card.id);
    state.mastered.delete(card.id);
    state.partial.delete(card.id);
  } else if (result === "partial") {
    state.partial.add(card.id);
    state.mastered.delete(card.id);
    state.needsReview.delete(card.id);
  } else {
    state.mastered.add(card.id);
    state.partial.delete(card.id);
    state.needsReview.delete(card.id);
  }
  if (state.studyMode === "exam") {
    const unratedAfter = state.queue.findIndex((item, index) => index > state.current && !getCardResult(item.id));
    const nextUnrated = unratedAfter >= 0 ? unratedAfter : state.queue.findIndex((item) => !getCardResult(item.id));
    if (nextUnrated >= 0) {
      state.current = nextUnrated;
      state.revealed = false;
      renderCard();
    } else {
      state.completed = true;
      state.revealed = false;
      renderCard();
    }
  } else if (state.current < state.queue.length - 1) {
    goToCard(1);
  } else {
    state.completed = true;
    state.revealed = false;
    renderCard();
  }
  updateStats();
}

function getCardResult(cardId) {
  if (state.mastered.has(cardId)) return "mastered";
  if (state.partial.has(cardId)) return "partial";
  if (state.needsReview.has(cardId)) return "review";
  return null;
}

function goToCard(delta) {
  const nextIndex = Math.max(0, Math.min(state.queue.length - 1, state.current + delta));
  if (nextIndex === state.current) return false;
  state.current = nextIndex;
  state.revealed = false;
  const flashcard = $("#flashcard");
  flashcard.classList.remove("card-pop");
  requestAnimationFrame(() => flashcard.classList.add("card-pop"));
  renderCard();
  return true;
}

function buildReviewQueue() {
  const reviewCards = state.cards.filter((card) => state.needsReview.has(card.id));
  if (!reviewCards.length) return;
  state.queue = shuffle(reviewCards);
  state.current = 0;
  state.revealed = false;
  state.completed = false;
  state.sessionMode = "review";
  renderCard();
}

function switchStudyMode(mode) {
  if (!['free', 'exam'].includes(mode) || state.studyMode === mode) return;
  state.studyMode = mode;
  state.examActive = false;
  state.completed = false;
  state.mastered.clear();
  state.partial.clear();
  state.needsReview.clear();
  if (mode === "free") buildQueue(true);
  else state.queue = [];
  updateModeUI();
  updateStats();
}

function updateModeUI() {
  $$("[data-study-mode]").forEach((button) => {
    const active = button.dataset.studyMode === state.studyMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const isExam = state.studyMode === "exam";
  $("#exam-setup").hidden = !isExam || state.examActive;
  $("#free-heading").hidden = isExam;
  $("#free-filters").hidden = isExam;
  $("#free-topics").hidden = isExam;
  $(".practice-area").hidden = isExam && !state.examActive;
  $("#partial-card").hidden = !isExam;
  $("#card-actions").classList.toggle("is-exam", isExam);
  $("#review-card").innerHTML = isExam
    ? '<span class="button-icon">✕</span> Non la so'
    : '<span class="button-icon">↺</span> Da ripassare';
  $("#next-card").innerHTML = isExam
    ? '<span class="button-icon">✓</span> La so'
    : '<span class="button-icon">✓</span> So rispondere';
  $(".swipe-hint").textContent = isExam
    ? "↔ Puoi rivedere le carte · girala prima di valutarti"
    : "↔ Scorri per cambiare carta · tocca per girarla";
}

function startExam() {
  state.examSubject = $('input[name="exam-subject"]:checked').value;
  state.examLength = Number($('input[name="exam-length"]:checked').value);
  state.mastered.clear();
  state.partial.clear();
  state.needsReview.clear();
  state.queue = buildBalancedExam(state.examSubject, state.examLength);
  state.current = 0;
  state.revealed = false;
  state.completed = false;
  state.examActive = true;
  state.sessionMode = "exam";
  updateModeUI();
  renderCard();
  updateStats();
}

function buildBalancedExam(subject, length) {
  const topicsByYear = ["1", "2"].map((year) => shuffle(state.topics.filter((topic) => topic.subject === subject && topic.year === year)));
  const orderedTopics = [];
  const maxTopics = Math.max(...topicsByYear.map((topics) => topics.length));
  for (let index = 0; index < maxTopics; index += 1) {
    topicsByYear.forEach((topics) => { if (topics[index]) orderedTopics.push(topics[index]); });
  }
  const cardsByTopic = new Map(orderedTopics.map((topic) => [topic.id, shuffle(state.cards.filter((card) => card.topicId === topic.id))]));
  const selected = [];
  let round = 0;
  while (selected.length < length) {
    let added = false;
    orderedTopics.forEach((topic) => {
      const card = cardsByTopic.get(topic.id)[round];
      if (card && selected.length < length) { selected.push(card); added = true; }
    });
    if (!added) break;
    round += 1;
  }
  return selected;
}

function resetExamSetup() {
  state.examActive = false;
  state.completed = false;
  state.queue = [];
  state.mastered.clear();
  state.partial.clear();
  state.needsReview.clear();
  $("#exam-results").hidden = true;
  updateModeUI();
  updateStats();
}

function reviewExamMistakes() {
  const weakIds = new Set([...state.needsReview, ...state.partial]);
  const weakCards = state.queue.filter((card) => weakIds.has(card.id));
  if (!weakCards.length) return;
  state.studyMode = "free";
  state.examActive = false;
  state.sessionMode = "review";
  state.queue = shuffle(weakCards);
  state.current = 0;
  state.revealed = false;
  state.completed = false;
  state.mastered.clear();
  state.partial.clear();
  state.needsReview = new Set(weakIds);
  $("#exam-results").hidden = true;
  updateModeUI();
  renderCard();
  updateStats();
}

function renderCard() {
  const card = state.queue[state.current];
  const flashcard = $("#flashcard");
  const empty = $("#empty-state");
  const actions = $("#card-actions");
  const navigation = $("#deck-navigation");
  if (!card) {
    flashcard.hidden = true;
    actions.hidden = true;
    navigation.hidden = true;
    $("#session-complete").hidden = true;
    $("#exam-results").hidden = true;
    empty.hidden = false;
    empty.querySelector("h3").textContent = "Nessuna carta qui, per ora.";
    empty.querySelector("p").textContent = "Seleziona almeno una macrocategoria oppure cambia i filtri per iniziare.";
    $("#card-counter").textContent = "— / —";
    $("#deck-progress-fill").style.width = "0%";
    return;
  }
  empty.hidden = true;
  flashcard.hidden = false;
  actions.hidden = false;
  navigation.hidden = false;
  flashcard.classList.toggle("is-flipped", state.revealed);
  flashcard.querySelector(".card-back").setAttribute("aria-hidden", String(!state.revealed));
  $("#card-area").textContent = card.area.toUpperCase();
  $("#card-year").textContent = card.year === "1" ? "1° ANNO" : "2° ANNO";
  $("#card-question").textContent = card.question;
  $("#card-category").textContent = card.category;
  $("#answer-category").textContent = card.category;
  $("#card-answer").innerHTML = renderMarkdown(card.answer);
  $("#card-counter").textContent = `${state.current + 1} / ${state.queue.length}`;
  $("#deck-progress-fill").style.width = `${((state.current + 1) / state.queue.length) * 100}%`;
  $("#session-label").textContent = state.sessionMode === "exam"
    ? `Simulazione · ${state.examLength} domande`
    : state.sessionMode === "review"
      ? `Ripasso mirato · ${state.queue.length} ${state.queue.length === 1 ? "carta" : "carte"}`
      : `${getFilteredTopics().length} argomenti selezionati`;
  $("#previous-card").disabled = state.current === 0;
  $("#forward-card").disabled = state.current === state.queue.length - 1;

  const isMastered = state.mastered.has(card.id);
  const isPartial = state.partial.has(card.id);
  const isReview = state.needsReview.has(card.id);
  const status = $("#card-status");
  status.textContent = isMastered
    ? "✓ La sai"
    : isPartial
      ? "≈ Quasi"
      : isReview
        ? state.studyMode === "exam" ? "✕ Non la sai" : "↺ Da rivedere"
        : "Non valutata";
  status.className = `card-status ${isMastered ? "is-mastered" : isPartial ? "is-partial" : isReview ? "is-review" : ""}`;
  $("#next-card").setAttribute("aria-pressed", String(isMastered));
  $("#partial-card").setAttribute("aria-pressed", String(isPartial));
  $("#review-card").setAttribute("aria-pressed", String(isReview));
  const evaluationLocked = state.studyMode === "exam" && !state.revealed;
  $("#next-card").disabled = evaluationLocked;
  $("#partial-card").disabled = evaluationLocked;
  $("#review-card").disabled = evaluationLocked;

  const complete = $("#session-complete");
  complete.hidden = state.studyMode === "exam" || !(state.completed && state.current === state.queue.length - 1);
  if (!complete.hidden) {
    const masteredCount = state.queue.filter((item) => state.mastered.has(item.id)).length;
    const reviewCount = state.queue.filter((item) => state.needsReview.has(item.id)).length;
    $("#complete-summary").textContent = `${masteredCount} sicure · ${reviewCount} da ripassare`;
    $("#review-session").disabled = reviewCount === 0;
  }
  const examResults = $("#exam-results");
  examResults.hidden = state.studyMode !== "exam" || !state.completed;
  if (!examResults.hidden) renderExamResults();
}

function renderExamResults() {
  const total = state.queue.length;
  const masteredCount = state.queue.filter((card) => state.mastered.has(card.id)).length;
  const partialCount = state.queue.filter((card) => state.partial.has(card.id)).length;
  const reviewCount = state.queue.filter((card) => state.needsReview.has(card.id)).length;
  const points = masteredCount + partialCount * .5;
  const percentage = total ? Math.round((points / total) * 100) : 0;
  const grade = total ? (points / total) * 10 : 0;
  $("#result-grade").textContent = grade.toFixed(1).replace(".", ",");
  $("#result-percentage").textContent = `${percentage}%`;
  $("#result-score-fill").style.width = `${percentage}%`;
  $("#result-mastered").textContent = masteredCount;
  $("#result-partial").textContent = partialCount;
  $("#result-review").textContent = reviewCount;
  $("#result-message").textContent = grade >= 8 ? "Ottima preparazione!" : grade >= 6 ? "Buona base, continua così!" : "C'è ancora spazio per migliorare";

  const weakScores = new Map();
  state.queue.forEach((card) => {
    const weight = state.needsReview.has(card.id) ? 2 : state.partial.has(card.id) ? 1 : 0;
    if (weight) weakScores.set(card.topicId, (weakScores.get(card.topicId) || 0) + weight);
  });
  const weakTopics = [...weakScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topicId]) => state.topics.find((topic) => topic.id === topicId)?.title)
    .filter(Boolean);
  $("#result-weak-areas").textContent = weakTopics.length ? weakTopics.join(" · ") : "Nessuna area debole rilevata.";
  $("#review-exam").disabled = reviewCount + partialCount === 0;
}

function toggleCard() {
  if (!state.queue[state.current]) return;
  state.revealed = !state.revealed;
  renderCard();
}

let swipeStart = null;
let suppressCardClick = false;
let suppressCardClickTimer = null;

function suppressSwipeClick() {
  suppressCardClick = true;
  clearTimeout(suppressCardClickTimer);
  suppressCardClickTimer = setTimeout(() => { suppressCardClick = false; }, 180);
}

function setupCardSwipe() {
  const flashcard = $("#flashcard");
  flashcard.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false };
    flashcard.setPointerCapture?.(event.pointerId);
  });
  flashcard.addEventListener("pointermove", (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    if (Math.hypot(deltaX, deltaY) > 10) swipeStart.moved = true;
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    flashcard.classList.add("is-dragging");
    flashcard.style.setProperty("--swipe-x", `${Math.max(-90, Math.min(90, deltaX))}px`);
  });
  const finishSwipe = (event) => {
    if (!swipeStart || event.pointerId !== swipeStart.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    const isSwipe = Math.abs(deltaX) >= 55 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
    const moved = swipeStart.moved;
    swipeStart = null;
    flashcard.classList.remove("is-dragging");
    flashcard.style.removeProperty("--swipe-x");
    if (isSwipe) {
      suppressSwipeClick();
      goToCard(deltaX < 0 ? 1 : -1);
    } else if (moved) {
      suppressSwipeClick();
    }
  };
  flashcard.addEventListener("pointerup", finishSwipe);
  flashcard.addEventListener("pointercancel", () => {
    swipeStart = null;
    flashcard.classList.remove("is-dragging");
    flashcard.style.removeProperty("--swipe-x");
  });
}

function openCurrentTheory() {
  const card = state.queue[state.current];
  if (!card) return;
  selectTheory(card.topicId);
  switchView("theory");
  $("#theory-view").scrollIntoView({ behavior: "smooth", block: "start" });
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
    startNewSession();
  }));
}

function renderTheoryList() {
  const list = $("#theory-topic-list");
  const topics = state.topics.filter((topic) => !state.theorySearch || `${topic.title} ${topic.area} ${topic.subject}`.toLowerCase().includes(state.theorySearch));
  const subjectOrder = ["Diritto ed Economia", "Scienze Umane"];
  const subjects = subjectOrder.map((subject) => ({ subject, topics: topics.filter((topic) => topic.subject === subject) })).filter((group) => group.topics.length);
  list.innerHTML = subjects.length ? subjects.map((group) => {
    const areas = [...new Set(group.topics.map((topic) => topic.area))];
    return `<section class="theory-group"><h4 class="theory-group-title">${escapeHtml(group.subject)}</h4>${areas.map((area) => `
      <div class="theory-area-group"><h5 class="theory-area-title">${escapeHtml(area)}</h5>${group.topics.filter((topic) => topic.area === area).map((topic) => `
        <button class="theory-topic-button ${topic.id === state.activeTheory ? "is-active" : ""}" data-theory-id="${topic.id}" type="button">
          <strong>${escapeHtml(topic.title)}</strong><span>${topic.year}° anno</span>
        </button>`).join("")}</div>`).join("")}</section>`;
  }).join("") : `<div class="theory-empty">Nessun argomento trovato.</div>`;
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
  startNewSession();
}

function resetCategorySelection() {
  state.selectedCategories.clear();
}

function updateStats() {
  $("#total-cards").textContent = state.cards.length || "—";
  $("#mastered-cards").textContent = new Set([...state.mastered, ...state.partial, ...state.needsReview]).size;
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
  let listTag = "ul";
  const flushParagraph = () => { if (paragraph.length) { html += `<p>${inlineMarkdown(paragraph.join(" "))}</p>`; paragraph = []; } };
  const flushList = () => { if (list.length) { html += `<${listTag}>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${listTag}>`; list = []; } };
  lines.forEach((line) => {
    if (/^\s*$/.test(line)) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^(#{2,3})\s+(.+)/);
    if (heading) { flushParagraph(); flushList(); html += `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`; return; }
    if (/^---+\s*$/.test(line)) { flushParagraph(); flushList(); html += "<hr>"; return; }
    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)/);
    if (bullet || numbered) {
      flushParagraph();
      const nextListTag = numbered ? "ol" : "ul";
      if (list.length && listTag !== nextListTag) flushList();
      listTag = nextListTag;
      list.push((bullet || numbered)[1]);
      return;
    }
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

function topicQuestion(title, parentTitle = "") {
  const plainTitle = stripMarkdown(title).replace(/^\d+\.\s*/, "").trim();
  const normalizedTitle = plainTitle.toLocaleLowerCase("it");
  const normalizedParent = stripMarkdown(parentTitle).replace(/^\d+\.\s*/, "").trim().toLocaleLowerCase("it");
  const contextualOverrides = {
    "il parlamento: composizione e funzioni|composizione": "Com'è composto il Parlamento?",
    "il presidente della repubblica|elezione": "Come viene eletto il Presidente della Repubblica?",
    "la banca|funzioni principali": "Quali sono le principali funzioni della banca?"
  };
  if (contextualOverrides[`${normalizedParent}|${normalizedTitle}`]) return contextualOverrides[`${normalizedParent}|${normalizedTitle}`];
  const questionOverrides = {
    "scarsità ed utilità": "Che cosa sono la scarsità e l'utilità?",
    "i soggetti: capacità giuridica e capacità d'agire": "Chi sono i soggetti del diritto e che differenza c'è tra capacità giuridica e capacità d'agire?",
    "lo stato: popolo, territorio e sovranità": "Quali sono i tre elementi costitutivi dello Stato?",
    "il governo: formazione e funzioni": "Che cos'è il Governo e da quali organi è composto?",
    "il parlamento: composizione e funzioni": "Che cos'è il Parlamento e com'è composto?",
    "la moneta: definizione e funzioni": "Che cos'è la moneta e quali funzioni svolge?",
    "la moneta bancaria, commerciale ed elettronica": "Quali sono le caratteristiche della moneta bancaria, commerciale ed elettronica?",
    "l'inflazione: definizione, cause ed effetti": "Che cos'è l'inflazione?",
    "metodologia della ricerca — che cosa significa fare ricerca": "Che cosa significa fare ricerca scientifica?",
    "la sovranità popolare - articolo 1": "Che cosa stabilisce l'articolo 1 sulla sovranità popolare?",
    "la sovranità popolare — articolo 1": "Che cosa stabilisce l'articolo 1 sulla sovranità popolare?",
    "la psicologia del lavoro oggi": "Di che cosa si occupa oggi la psicologia del lavoro?",
    "comprendere il significato degli indici": "Come si interpreta il significato degli indici statistici?",
    "solo gli uomini parlano": "Perché si dice che solo gli esseri umani parlano?",
    "tolman e l'apprendimento latente": "Che cos'è l'apprendimento latente studiato da Tolman?",
    "euristiche e bias (pregiudizi cognitivi)": "Che cosa sono le euristiche e i bias cognitivi?",
    "la personalità nell'infanzia e nelle diverse età della vita": "Come si sviluppa la personalità nelle diverse età della vita?",
    "apprendere per tradizione e per imitazione": "Come avviene l'apprendimento per tradizione e per imitazione?",
    "pregiudizio e conflittualità": "Qual è il rapporto tra pregiudizio e conflittualità?",
    "come attenuare i pregiudizi": "Come si possono attenuare i pregiudizi?"
  };
  if (questionOverrides[normalizedTitle]) return questionOverrides[normalizedTitle];

  const directQuestion = /^(?:che cosa|cosa|cos['’]è|come|quando|dove|perché|perche|chi)(?:\s+|$)/i.test(plainTitle);
  if (directQuestion) {
    const question = plainTitle
      .replace(/^cos['’]è(?=\s|$)/i, "Che cos'è")
      .replace(/^cosa(?=\s|$)/i, "Che cosa");
    return `${upperFirst(question).replace(/[.?!]+$/, "")}?`;
  }

  if (isPersonName(plainTitle)) return `Chi è ${plainTitle}?`;

  const namedTheory = plainTitle.match(/^(.+?)\s+[—-]\s+([A-ZÀ-Ý][\p{L}'’.-]+)$/u);
  if (namedTheory) return `Spiegami ${withArticle(namedTheory[1])} secondo ${namedTheory[2]}.`;

  return `Spiegami ${naturalTopicPhrase(plainTitle)}.`;
}

function definitionQuestion(term) {
  const phrase = withArticle(term)
    .replace(/\bstato\b/gi, "Stato")
    .replace(/\bgoverno\b/gi, "Governo")
    .replace(/\bparlamento\b/gi, "Parlamento")
    .replace(/\bpresidente della repubblica\b/gi, "Presidente della Repubblica")
    .replace(/\bcostituzione italiana\b/gi, "Costituzione italiana");
  return isPluralTerm(term) ? `Che cosa sono ${phrase}?` : `Che cos'è ${phrase}?`;
}

function naturalTopicPhrase(title) {
  let phrase = stripMarkdown(title)
    .replace(/^\d+\.\s*/, "")
    .replace(/^PARTE\s+\d+\s*-\s*/i, "")
    .replace(/\s+—\s+/g, ": ")
    .replace(/\s+-\s+/g, ": ")
    .trim();
  return withArticle(phrase);
}

function withArticle(value) {
  const phrase = stripMarkdown(value).replace(/\s+ed\s+/gi, " e ").trim();
  if (!phrase) return phrase;
  const colonIndex = phrase.indexOf(":");
  if (colonIndex > 0) {
    const head = phrase.slice(0, colonIndex).trim();
    const tail = phrase.slice(colonIndex + 1).trim();
    if (/^(?:che cosa|cos'è|come|quando|dove|perché|perche|chi)\b/i.test(tail)) return `${withArticle(head)}: ${lowerFirst(tail)}`;
    if (/^(?:il|lo|la|i|gli|le|un|uno|una|l'|articolo)\b/i.test(tail)) return `${withArticle(head)}: ${lowerFirst(tail)}`;
    if (/^[A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)+$/.test(tail)) return `${withArticle(head)}: ${tail}`;
    if (/^cenni$/i.test(tail)) return `${withArticle(head)}, con alcuni cenni`;
    return `${withArticle(head)}, ${withArticleList(tail)}`;
  }
  const parts = phrase.split(/\s+e\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 || phrase.includes(",")) return withArticleList(phrase);
  return withSingleArticle(phrase);
}

function withArticleList(value) {
  return value.split(/(\s+e\s+|,\s*)/i).map((part) => {
    if (/^\s*e\s*$/i.test(part) || /^,\s*$/.test(part)) return part;
    return withSingleArticle(part.trim());
  }).join("");
}

function withSingleArticle(phrase) {
  if (/^(?:il|lo|la|i|gli|le|un|uno|una|l')\b/i.test(phrase)) return lowerFirst(phrase);
  const firstWord = phrase.match(/^[^\s:,(]+/)?.[0] || phrase;
  const article = articleForWord(firstWord);
  return article === "l'" ? `l'${lowerFirst(phrase)}` : `${article} ${lowerFirst(phrase)}`;
}

function articleForWord(word) {
  const normalized = word.toLowerCase().replace(/^[^a-zàèéìòù]+|[^a-zàèéìòù]+$/gi, "");
  const masculine = new Set(["costo-opportunità", "sistema", "problema", "tema", "programma", "clima", "schema"]);
  const feminine = new Set(["scarsità", "utilità", "economia", "percezione", "memoria", "intelligenza", "personalità", "comunicazione", "ricerca", "statistica", "cognizione", "influenza", "moneta", "banca", "cambiale", "inflazione", "deflazione", "democrazia", "magistratura", "sovranità", "costituzione", "uguaglianza", "metodologia", "psicologia", "motivazione", "emozione", "emozioni", "capacità"]);
  const femininePlural = new Set(["forme", "norme", "fonti", "situazioni", "persone", "funzioni", "teorie", "relazioni", "scienze", "cause", "conseguenze", "variabili", "origini", "emozioni", "attribuzioni", "istanze", "scelte", "amnesie"]);
  if (femininePlural.has(normalized) || /(?:zioni|sioni|enze|anze|ezze|ure)$/.test(normalized)) return "le";
  if (normalized.endsWith("i") && !["analisi", "ipotesi", "tesi", "crisi", "sintesi"].includes(normalized)) {
    if (/^[aeiouàèéìòù]/i.test(normalized)) return "gli";
    return /^(s[^aeiouàèéìòù]|z|gn|ps|x|y)/i.test(normalized) ? "gli" : "i";
  }
  if (/^[aeiouàèéìòù]/i.test(normalized)) return "l'";
  if (masculine.has(normalized)) return "il";
  if (feminine.has(normalized) || /(?:a|zione|sione|tà|enza|anza|ezza|ura|ità)$/.test(normalized)) return "la";
  if (/^(s[^aeiouàèéìòù]|z|gn|ps|x|y)/i.test(normalized)) return "lo";
  return "il";
}

function isPluralTerm(term) {
  const firstWord = stripMarkdown(term).trim().match(/^[^\s:,(]+/)?.[0] || term;
  const normalized = firstWord.toLowerCase().replace(/[^a-zàèéìòù]/gi, "");
  return new Set(["forme", "norme", "fonti", "situazioni", "persone", "funzioni", "teorie", "relazioni", "scienze", "cause", "conseguenze", "variabili", "origini", "emozioni", "attribuzioni", "istanze", "scelte", "amnesie"]).has(normalized)
    || /(?:zioni|sioni|enze|anze|ezze|ure)$/.test(normalized)
    || (normalized.endsWith("i") && !["analisi", "ipotesi", "tesi", "crisi", "sintesi"].includes(normalized));
}

function isListBlock(block) { return /^(?:\s*[-*]\s+|\s*\d+[.)]\s+)/.test(block); }

function lowerFirst(value) { return value.charAt(0).toLowerCase() + value.slice(1); }
function upperFirst(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function isPersonName(value) { return new Set(["alfred adler", "carl gustav jung"]).has(value.toLocaleLowerCase("it")); }

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
