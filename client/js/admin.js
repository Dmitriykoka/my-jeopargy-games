let packs = [];
let current = null;

const packList = document.getElementById('pack-list');
const editor = document.getElementById('editor');
const categoriesEl = document.getElementById('categories');

async function loadPacks() {
  packs = await fetch('/api/packs').then((r) => r.json());
  packList.innerHTML = packs
    .map(
      (p) => `<li style="cursor:pointer" data-id="${p.id}">
        <span>${escapeHtml(p.name)}</span>
        <span class="muted">${p.categories} тем / ${p.questions} вопр.</span>
      </li>`
    )
    .join('') || '<li class="muted">Пока нет пакетов</li>';

  packList.querySelectorAll('li[data-id]').forEach((li) => {
    li.onclick = () => openPack(li.dataset.id);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function openPack(id) {
  current = await fetch('/api/packs/' + id).then((r) => r.json());
  editor.hidden = false;
  document.getElementById('editor-title').textContent = current.name;
  document.getElementById('edit-name').value = current.name;
  renderCategories();
}

function renderCategories() {
  if (!current.categories) current.categories = [];
  categoriesEl.innerHTML = current.categories
    .map(
      (cat, ci) => `<div class="cat-block" data-ci="${ci}">
      <div class="actions" style="justify-content:space-between;margin-bottom:0.5rem">
        <input value="${escapeHtml(cat.name)}" data-role="cat-name" style="flex:1" />
        <button type="button" class="bad" data-role="del-cat">Удалить тему</button>
      </div>
      ${(cat.questions || [])
        .map(
          (q, qi) => `<div class="q-row" data-qi="${qi}">
          <input type="number" value="${q.cost}" data-f="cost" title="Стоимость" />
          <input value="${escapeHtml(q.question)}" data-f="question" placeholder="Вопрос" />
          <input value="${escapeHtml(q.answer)}" data-f="answer" placeholder="Ответ" />
          <input value="${escapeHtml(q.media || '')}" data-f="media" placeholder="media/файл" />
          <select data-f="mediaType">
            <option value="" ${!q.mediaType ? 'selected' : ''}>—</option>
            <option value="image" ${q.mediaType === 'image' ? 'selected' : ''}>image</option>
            <option value="audio" ${q.mediaType === 'audio' ? 'selected' : ''}>audio</option>
            <option value="video" ${q.mediaType === 'video' ? 'selected' : ''}>video</option>
          </select>
          <button type="button" class="ghost" data-role="del-q">×</button>
        </div>`
        )
        .join('')}
      <button type="button" class="secondary" data-role="add-q" style="margin-top:0.5rem">+ Вопрос</button>
    </div>`
    )
    .join('');

  categoriesEl.querySelectorAll('.cat-block').forEach((block) => {
    const ci = Number(block.dataset.ci);
    block.querySelector('[data-role="cat-name"]').oninput = (e) => {
      current.categories[ci].name = e.target.value;
    };
    block.querySelector('[data-role="del-cat"]').onclick = () => {
      current.categories.splice(ci, 1);
      renderCategories();
    };
    block.querySelector('[data-role="add-q"]').onclick = () => {
      if (!current.categories[ci].questions) current.categories[ci].questions = [];
      const n = current.categories[ci].questions.length;
      current.categories[ci].questions.push({
        id: uid(),
        cost: (n + 1) * 100,
        question: '',
        answer: '',
        media: null,
        mediaType: null,
      });
      renderCategories();
    };
    block.querySelectorAll('.q-row').forEach((row) => {
      const qi = Number(row.dataset.qi);
      row.querySelectorAll('[data-f]').forEach((input) => {
        input.oninput = () => {
          const f = input.dataset.f;
          let v = input.value;
          if (f === 'cost') v = Number(v) || 0;
          if (f === 'media' && !v) v = null;
          if (f === 'mediaType' && !v) v = null;
          current.categories[ci].questions[qi][f] = v;
        };
      });
      row.querySelector('[data-role="del-q"]').onclick = () => {
        current.categories[ci].questions.splice(qi, 1);
        renderCategories();
      };
    });
  });
}

document.getElementById('btn-create-pack').onclick = async () => {
  const name = document.getElementById('new-pack-name').value.trim();
  if (!name) {
    toast('Сначала укажите название пакета');
    return;
  }
  const pack = await fetch('/api/packs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then((r) => r.json());
  if (pack.error) {
    toast(pack.error);
    return;
  }
  document.getElementById('new-pack-name').value = '';
  toast('Пакет создан', true);
  await loadPacks();
  openPack(pack.id);
};

document.getElementById('btn-add-cat').onclick = () => {
  if (!current) return;
  current.categories.push({
    id: uid(),
    name: 'Новая тема',
    questions: [],
  });
  renderCategories();
};

document.getElementById('btn-save-pack').onclick = async () => {
  if (!current) return;
  current.name = document.getElementById('edit-name').value.trim();
  if (!current.name) {
    toast('Название пакета обязательно');
    return;
  }
  const res = await fetch('/api/packs/' + current.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(current),
  }).then((r) => r.json());
  if (res.error) toast(res.error);
  else {
    toast('Сохранено', true);
    current = res;
    loadPacks();
  }
};

document.getElementById('btn-delete-pack').onclick = async () => {
  if (!current || !confirm('Удалить пакет?')) return;
  await fetch('/api/packs/' + current.id, { method: 'DELETE' });
  current = null;
  editor.hidden = true;
  toast('Удалён', true);
  loadPacks();
};

document.getElementById('btn-import').onclick = async () => {
  if (!current) {
    toast('Сначала создайте пакет и укажите имя');
    return;
  }
  const file = document.getElementById('import-file').files[0];
  if (!file) {
    toast('Выберите Excel-файл');
    return;
  }
  const fd = new FormData();
  fd.append('file', file);
  if (document.getElementById('import-replace').checked) fd.append('mode', 'replace');
  const res = await fetch('/api/packs/' + current.id + '/import', {
    method: 'POST',
    body: fd,
  }).then((r) => r.json());
  if (res.error) {
    toast(res.error);
    return;
  }
  toast('Импорт выполнен', true);
  current = res.pack;
  renderCategories();
  loadPacks();
};

loadPacks();
