/* shared helpers */
function toast(msg, ok = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? ' ok' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function mediaUrl(rel) {
  if (!rel) return null;
  return '/media/' + String(rel).replace(/^\/+/, '');
}

function renderMedia(container, question) {
  container.innerHTML = '';
  if (!question?.media) return;
  const url = mediaUrl(question.media);
  const type = question.mediaType || 'image';
  if (type === 'audio') {
    const a = document.createElement('audio');
    a.controls = true;
    a.src = url;
    a.autoplay = true;
    container.appendChild(a);
  } else if (type === 'video') {
    const v = document.createElement('video');
    v.controls = true;
    v.src = url;
    v.autoplay = true;
    container.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Медиа вопроса';
    container.appendChild(img);
  }
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}
