// Allowed challenge upload types: extension -> MIME type and a check on the
// file's first bytes, so a renamed file can't slip through.
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);

const TYPES = {
  pdf: { mime: 'application/pdf', check: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]) }, // %PDF-
  doc: { mime: 'application/msword', check: (b) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]) },
  png: { mime: 'image/png', check: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  jpeg: { mime: 'image/jpeg', check: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  txt: { mime: 'text/plain', check: (b) => !b.subarray(0, 8192).includes(0) },
};

const extOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
};

// Keeps a readable, harmless version of the original file name for display
const safeName = (name) => String(name || 'file').normalize('NFC')
  .replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';

module.exports = { TYPES, MAX_FILE_BYTES, extOf, safeName };
