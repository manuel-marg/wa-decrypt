const express = require('express');
const crypto = require('crypto');
const https = require('https');

const app = express();
app.use(express.json());

const INFO_TYPES = {
  image: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys'
};

function hkdf(key, info, length) {
  return new Promise((resolve, reject) => {
    crypto.hkdf('sha256', key, Buffer.alloc(32), Buffer.from(info), length, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(Buffer.from(derivedKey));
    });
  });
}

function downloadEncryptedFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Error CDN WhatsApp: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

app.post('/decrypt', async (req, res) => {
  try {
    const { url, mediaKey, type = 'image' } = req.body;

    if (!url || !mediaKey) {
      return res.status(400).json({ success: false, error: 'url y mediaKey son requeridos' });
    }

    // 1. Derivar claves con HKDF-SHA256
    const mediaKeyBuffer = Buffer.from(mediaKey, 'base64');
    const info = INFO_TYPES[type] || INFO_TYPES.image;
    const expanded = await hkdf(mediaKeyBuffer, info, 112);

    const iv = expanded.subarray(0, 16);
    const cipherKey = expanded.subarray(16, 48);

    // 2. Descargar archivo cifrado .enc de WhatsApp
    const fileBuffer = await downloadEncryptedFile(url);

    // 3. Quitar los últimos 10 bytes (MAC)
    const encData = fileBuffer.subarray(0, fileBuffer.length - 10);

    // 4. Descifrar con AES-256-CBC
    const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
    const decrypted = Buffer.concat([decipher.update(encData), decipher.final()]);

    // Responder con el base64 real
    res.json({
      success: true,
      size: decrypted.length,
      base64: decrypted.toString('base64')
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = 3005;
app.listen(PORT, () => {
  console.log(`Servidor de descifrado activo en el puerto ${PORT}`);
});