const express = require('express');
const { createServer } = require('./server');

function createApp(options = {}) {
  const app = express();
  let applicationServer;

  app.use(async (request, response, next) => {
    try {
      if (!applicationServer) {
        applicationServer = createServer(options);
      }
      await applicationServer.handleRequest(request, response);
    } catch (error) {
      console.error('Gagal menginisialisasi aplikasi:', error);
      if (response.headersSent) {
        next(error);
        return;
      }
      response.status(500).type('text/plain')
        .send('Terjadi kesalahan pada server.');
    }
  });

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
  });
}
