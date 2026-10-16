const fs = require('node:fs');
const path = require('node:path');
const VIEWS_DIRECTORY = path.join(__dirname, '..', 'views');
const PARTIALS_DIRECTORY = path.join(VIEWS_DIRECTORY, 'partials');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderTemplate(template, data) {
  const withPartials = template.replace(/\{\{>\s*([^{}]+?)\s*\}\}/g, (_, partialName) => {
    if (!/^[\w/-]+$/.test(partialName)) {
      throw new Error(`Path partial tidak valid: ${partialName}`);
    }
    const partialPath = path.resolve(PARTIALS_DIRECTORY, `${partialName}.html`);
    if (!partialPath.startsWith(`${PARTIALS_DIRECTORY}${path.sep}`)) {
      throw new Error(`Path partial tidak valid: ${partialName}`);
    }
    return fs.readFileSync(partialPath, 'utf8');
  });

  return withPartials.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(data[key] ?? ''));
}

function render(response, viewPath, data = {}) {
  const filePath = path.join(VIEWS_DIRECTORY, viewPath);
  const template = fs.readFileSync(filePath, 'utf8');
  const html = renderTemplate(template, data);

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(html);
}

function redirect(response, location) {
  response.writeHead(303, { Location: location });
  response.end();
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function sendStylesheet(response) {
  const filePath = path.join(__dirname, '..', 'views', 'styles.css');
  response.writeHead(200, {
    'Content-Type': 'text/css; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(fs.readFileSync(filePath, 'utf8'));
}

module.exports = { render, renderTemplate, redirect, sendJson, sendStylesheet };
