'use strict';

// ===== Estado de la aplicación =====
const state = {
  currentText: '',
  matches: [],
  ignoredOffsets: new Set(),
  activePopupMatchIndex: null,
};

// ===== Referencias DOM =====
const inputText       = document.getElementById('inputText');
const checkBtn        = document.getElementById('checkBtn');
const clearBtn        = document.getElementById('clearBtn');
const charCount       = document.getElementById('charCount');
const resultsSection  = document.getElementById('resultsSection');
const annotatedText   = document.getElementById('annotatedText');
const errorSummary    = document.getElementById('errorSummary');
const totalCountEl    = document.getElementById('totalCount');
const categoryList    = document.getElementById('categoryList');
const noErrorsMsg     = document.getElementById('noErrorsMsg');
const popup           = document.getElementById('popup');
const popupCategory   = document.getElementById('popupCategory');
const popupMessage    = document.getElementById('popupMessage');
const suggestionsList = document.getElementById('suggestionsList');
const popupClose      = document.getElementById('popupClose');
const btnIgnore       = document.getElementById('btnIgnore');
const overlay         = document.getElementById('overlay');
const loadingIndicator = document.getElementById('loadingIndicator');

// ===== Configuración =====
const API_URL = 'https://api.languagetool.org/v2/check';
const MAX_CHARS = 20000;

// Mapeo de categorías a íconos y nombres en español
const CATEGORY_MAP = {
  TYPOS:              { icon: '🔤', name: 'Ortografía' },
  TYPOGRAPHY:         { icon: '✏️', name: 'Tipografía' },
  GRAMMAR:            { icon: '📖', name: 'Gramática' },
  CASING:             { icon: '🔡', name: 'Mayúsculas' },
  PUNCTUATION:        { icon: '❓', name: 'Puntuación' },
  CONFUSED_WORDS:     { icon: '🔀', name: 'Palabras confundidas' },
  REDUNDANCY:         { icon: '♻️', name: 'Redundancia' },
  STYLE:              { icon: '✨', name: 'Estilo' },
  GENDER_NEUTRALITY:  { icon: '⚖️', name: 'Género' },
  SEMANTICS:          { icon: '💬', name: 'Semántica' },
};

function getCategoryInfo(categoryId) {
  return CATEGORY_MAP[categoryId] || { icon: '⚠️', name: categoryId || 'Otro' };
}

// ===== Contador de caracteres =====
inputText.addEventListener('input', () => {
  const len = inputText.value.length;
  charCount.textContent = `${len.toLocaleString()} caractere${len !== 1 ? 's' : ''}`;
  if (len > MAX_CHARS) {
    charCount.style.color = 'var(--error-color)';
  } else {
    charCount.style.color = '';
  }
});

// ===== Verificar ortografía =====
checkBtn.addEventListener('click', async () => {
  const text = inputText.value.trim();
  if (!text) {
    alert('Por favor escribe algún texto antes de verificar.');
    return;
  }
  if (text.length > MAX_CHARS) {
    alert(`El texto es demasiado largo. Máximo ${MAX_CHARS.toLocaleString()} caracteres.`);
    return;
  }

  state.ignoredOffsets.clear();
  await runCheck(text);
});

async function runCheck(text) {
  setLoading(true);
  checkBtn.disabled = true;
  closePopup();

  try {
    const matches = await checkSpelling(text);
    state.currentText = text;
    state.matches = matches;
    renderResults(text, matches);
  } catch (err) {
    console.error('Error al verificar ortografía:', err);
    alert('No se pudo conectar con el servicio de verificación. Comprueba tu conexión a internet e inténtalo de nuevo.');
  } finally {
    setLoading(false);
    checkBtn.disabled = false;
  }
}

// ===== Llamada a la API de LanguageTool =====
async function checkSpelling(text) {
  const body = new URLSearchParams({
    text: text,
    language: 'es',
    enabledOnly: 'false',
  });

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.matches || [];
}

// ===== Renderizar resultados =====
function renderResults(text, matches) {
  // Filtrar ignorados
  const activeMatches = matches.filter(
    m => !state.ignoredOffsets.has(m.offset)
  );

  // Mostrar u ocultar secciones
  noErrorsMsg.style.display = 'none';
  resultsSection.style.display = 'none';

  if (activeMatches.length === 0) {
    noErrorsMsg.style.display = 'flex';
    return;
  }

  resultsSection.style.display = 'grid';
  annotatedText.innerHTML = annotateText(text, activeMatches);
  renderSummary(activeMatches);

  // Añadir listeners a los spans de error
  const errorSpans = annotatedText.querySelectorAll('.error');
  errorSpans.forEach(span => {
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(span.dataset.matchIndex, 10);
      const match = activeMatches[idx];
      showPopup(match, span, idx);
    });
  });
}

// ===== Construir HTML anotado =====
function annotateText(text, matches) {
  if (!matches.length) return escapeHtml(text);

  // Ordenar por offset ascendente
  const sorted = [...matches].sort((a, b) => a.offset - b.offset);

  let html = '';
  let cursor = 0;

  sorted.forEach((match, idx) => {
    const { offset, length } = match;

    // Añadir texto antes del error (escapado)
    if (offset > cursor) {
      html += escapeHtml(text.slice(cursor, offset));
    }

    const errorWord = text.slice(offset, offset + length);
    const categoryId = match.rule?.category?.id || '';
    const { name: catName } = getCategoryInfo(categoryId);
    const tip = match.message || catName;

    html += `<span
      class="error"
      data-match-index="${idx}"
      data-offset="${offset}"
      data-length="${length}"
      title="${escapeAttr(tip)}"
      tabindex="0"
      role="button"
      aria-label="Error: ${escapeAttr(errorWord)}. ${escapeAttr(tip)}"
    >${escapeHtml(errorWord)}</span>`;

    cursor = offset + length;
  });

  // Resto del texto
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor));
  }

  return html;
}

// ===== Renderizar resumen =====
function renderSummary(matches) {
  totalCountEl.textContent = matches.length;

  // Agrupar por categoría
  const categories = {};
  matches.forEach(m => {
    const catId = m.rule?.category?.id || 'OTHER';
    categories[catId] = (categories[catId] || 0) + 1;
  });

  categoryList.innerHTML = '';
  Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .forEach(([catId, count]) => {
      const { icon, name } = getCategoryInfo(catId);
      const li = document.createElement('li');
      li.className = 'category-item';
      li.innerHTML = `
        <span class="category-icon">${icon}</span>
        <span class="category-name">${escapeHtml(name)}</span>
        <span class="category-count">${count}</span>
      `;
      categoryList.appendChild(li);
    });
}

// ===== Mostrar popup =====
function showPopup(match, anchorEl, matchIdx) {
  state.activePopupMatchIndex = matchIdx;

  const categoryId = match.rule?.category?.id || '';
  const { icon, name } = getCategoryInfo(categoryId);

  popupCategory.textContent = `${icon} ${name}`;
  popupMessage.textContent = match.message || 'Error detectado.';

  // Sugerencias
  suggestionsList.innerHTML = '';
  const replacements = match.replacements || [];
  const maxSuggestions = 6;

  if (replacements.length === 0) {
    suggestionsList.innerHTML = '<span class="no-suggestions">Sin sugerencias disponibles</span>';
  } else {
    replacements.slice(0, maxSuggestions).forEach(r => {
      const btn = document.createElement('button');
      btn.className = 'suggestion-btn';
      btn.textContent = r.value;
      btn.addEventListener('click', () => {
        applyCorrection(match.offset, match.length, r.value);
      });
      suggestionsList.appendChild(btn);
    });
  }

  // Posicionar popup cerca del elemento de error
  popup.style.display = 'block';
  overlay.style.display = 'block';
  positionPopup(anchorEl);
}

function positionPopup(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const popupW = popup.offsetWidth || 280;
  const popupH = popup.offsetHeight || 200;
  const margin = 8;

  let top = rect.bottom + margin + window.scrollY;
  let left = rect.left + window.scrollX;

  // Evitar salirse por la derecha
  if (left + popupW > window.innerWidth - margin) {
    left = window.innerWidth - popupW - margin;
  }
  // Evitar salirse por abajo
  if (top + popupH > window.innerHeight + window.scrollY - margin) {
    top = rect.top - popupH - margin + window.scrollY;
  }

  popup.style.top = `${Math.max(margin, top)}px`;
  popup.style.left = `${Math.max(margin, left)}px`;
}

function closePopup() {
  popup.style.display = 'none';
  overlay.style.display = 'none';
  state.activePopupMatchIndex = null;
}

// ===== Aplicar corrección =====
function applyCorrection(offset, length, replacement) {
  const text = state.currentText;
  const newText = text.slice(0, offset) + replacement + text.slice(offset + length);

  // Actualizar textarea y estado
  inputText.value = newText;
  charCount.textContent = `${newText.length.toLocaleString()} caractere${newText.length !== 1 ? 's' : ''}`;

  closePopup();

  // Re-verificar automáticamente
  runCheck(newText);
}

// ===== Ignorar error =====
btnIgnore.addEventListener('click', () => {
  const idx = state.activePopupMatchIndex;
  if (idx === null) return;

  const activeMatches = state.matches.filter(
    m => !state.ignoredOffsets.has(m.offset)
  );
  const match = activeMatches[idx];
  if (match) {
    state.ignoredOffsets.add(match.offset);
  }

  closePopup();
  renderResults(state.currentText, state.matches);
});

// ===== Cerrar popup =====
popupClose.addEventListener('click', closePopup);
overlay.addEventListener('click', closePopup);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePopup();
});

// ===== Limpiar =====
clearBtn.addEventListener('click', () => {
  inputText.value = '';
  charCount.textContent = '0 caracteres';
  charCount.style.color = '';
  resultsSection.style.display = 'none';
  noErrorsMsg.style.display = 'none';
  state.currentText = '';
  state.matches = [];
  state.ignoredOffsets.clear();
  closePopup();
  inputText.focus();
});

// ===== Indicador de carga =====
function setLoading(active) {
  loadingIndicator.style.display = active ? 'flex' : 'none';
}

// ===== Utilidades =====
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
