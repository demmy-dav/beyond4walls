// Leadership team cards on the about page, built from data/team.json.
// To add or edit someone, change data/team.json only:
//   { "name": "...", "role": "...", "bio": "optional one line", "photo": "firstname-lastname.jpg", "order": 3 }
// Photos live in assets/team/. People without a photo get an initials tile.
(function () {
  const section = document.getElementById('team');
  const grid = section && section.querySelector('[data-team-grid]');
  if (!grid) return;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  // First letter of the first and last word, ignoring anything in brackets
  const initials = (name) => {
    const words = name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toUpperCase();
  };

  function card(person, index) {
    const li = el('li', 'board-card team-card' + (index === 0 ? ' team-card--lead' : ''));

    // Brand colour for the initials tile, rotated so neighbours differ
    const photo = el('div', 'board-card__photo team-card__photo team-card__photo--' + (index % 3));
    photo.append(el('span', 'team-card__initials', initials(person.name)));
    photo.firstChild.setAttribute('aria-hidden', 'true');
    if (person.photo) {
      const img = el('img');
      img.src = 'assets/team/' + person.photo;
      img.alt = 'Portrait of ' + person.name + ', ' + person.role;
      img.width = 640;
      img.height = 800;
      img.loading = 'lazy';
      img.decoding = 'async';
      // A missing file falls back to the initials tile instead of a broken image
      img.addEventListener('error', () => img.remove());
      photo.append(img);
    }

    const info = el('div', 'board-card__info team-card__info');
    info.append(el('h3', 'board-card__name team-card__name', person.name));
    info.append(el('p', 'board-card__role team-card__role', person.role));
    if (person.bio) info.append(el('p', 'team-card__bio', person.bio));

    li.append(photo, info);
    return li;
  }

  fetch('data/team.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status))))
    .then((people) => {
      const list = (Array.isArray(people) ? people : [])
        .filter((p) => p && p.name && p.role)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      if (!list.length) return;
      grid.replaceChildren(...list.map(card));
      section.hidden = false;
    })
    .catch(() => { /* leave the section hidden */ });
})();
