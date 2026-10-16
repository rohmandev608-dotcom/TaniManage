const View = require('../core/View');

function index(request, response) {
  View.render(response, pathForHomeView);
}

const pathForHomeView = 'home/index.html';

module.exports = { index };
