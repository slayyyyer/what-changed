// Progressive enhancement only. The pages are complete without this file; here
// we filter the already-rendered list and keep the count honest.

(function () {
  const form = document.querySelector('[data-role="filter"]');
  if (!form) return;

  const query = form.querySelector('[data-role="query"]');
  const count = form.querySelector('[data-role="count"]');
  const pills = Array.from(form.querySelectorAll('.pill[data-kind]'));
  const rows = Array.from(document.querySelectorAll('.change'));

  let kind = 'all';

  function apply() {
    const needle = (query?.value || '').trim().toLowerCase();
    let shown = 0;

    for (const row of rows) {
      const matchesKind = kind === 'all' || row.dataset.kind === kind;
      const haystack = row.dataset.search || '';
      const matchesText = needle === '' || haystack.includes(needle);
      const visible = matchesKind && matchesText;
      row.classList.toggle('is-filtered-out', !visible);
      if (visible) shown += 1;
    }

    // Hide a source heading when every row under it is filtered away.
    for (const list of document.querySelectorAll('.changes')) {
      const heading = list.previousElementSibling;
      if (!heading || !heading.classList.contains('sectionhead')) continue;
      const anyVisible = Array.from(list.querySelectorAll('.change')).some(
        (row) => !row.classList.contains('is-filtered-out'),
      );
      heading.classList.toggle('is-filtered-out', !anyVisible);
    }

    if (count) {
      count.textContent =
        needle === '' && kind === 'all'
          ? `${rows.length} item${rows.length === 1 ? '' : 's'}`
          : `${shown} of ${rows.length} item${rows.length === 1 ? '' : 's'} shown`;
    }
  }

  query?.addEventListener('input', apply);
  form.addEventListener('submit', (event) => event.preventDefault());

  for (const pill of pills) {
    pill.addEventListener('click', () => {
      kind = pill.dataset.kind || 'all';
      for (const other of pills) {
        const on = other === pill;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      apply();
    });
  }

  apply();
})();
