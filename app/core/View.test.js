const test = require('node:test');
const assert = require('node:assert/strict');
const { renderTemplate } = require('./View');

test('view templates can include reusable sidebar and navbar partials', () => {
  const html = renderTemplate(
    '{{>sidebar}}{{>navbar}}',
    {
      name: '<Petani>',
      csrfToken: 'csrf-token',
      pageTitle: 'Tambah Lahan Baru',
      dashboardNavClass: 'dashboard-link',
      landNavClass: 'active-link'
    }
  );

  assert.match(html, /id="sidebar"/);
  assert.match(html, /id="menuToggle"/);
  assert.match(html, /Tambah Lahan Baru/);
  assert.match(html, /&lt;Petani&gt;/);
  assert.match(html, /class="active-link"/);
  assert.doesNotMatch(html, /\{\{(?:>|\w)/);
});

test('view partials reject paths outside the partial directory', () => {
  assert.throws(
    () => renderTemplate('{{>../../package}}', {}),
    /partial/
  );
});
