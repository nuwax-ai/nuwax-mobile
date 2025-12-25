// Extension to file type mapping
const EXTENSION_MAP = {
  // Documents
  docx: 'docx',
  doc: 'docx',
  xlsx: 'xlsx',
  xls: 'xlsx',
  pptx: 'pptx',
  ppt: 'pptx',
  pdf: 'pdf',
  // Images
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  // Audio
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  // Video
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  mkv: 'video',
  // HTML
  html: 'html',
  htm: 'html',
  // Markdown
  md: 'markdown',
  markdown: 'markdown',
  // Text/Code
  txt: 'text',
  json: 'text',
  xml: 'text',
  js: 'text',
  jsx: 'text',
  ts: 'text',
  tsx: 'text',
  css: 'text',
  less: 'text',
  scss: 'text',
  sass: 'text',
  yaml: 'text',
  yml: 'text',
  ini: 'text',
  conf: 'text',
  sh: 'text',
  bash: 'text',
  py: 'text',
  java: 'text',
  c: 'text',
  cpp: 'text',
  h: 'text',
  go: 'text',
  rs: 'text',
  rb: 'text',
  php: 'text',
  sql: 'text',
  log: 'text',
  csv: 'text',
  vue: 'text',
  uts: 'text'
};

export const getExtension = (name) => {
  if (!name) return '';
  // 移除 URL 参数
  const cleanName = name.split('?')[0].split('#')[0];
  const parts = cleanName.split('.');
  if (parts.length > 1) {
    return parts[parts.length - 1].toLowerCase();
  }
  return '';
};

export const getFileTypeFromName = (name) => {
  const ext = getExtension(name);
  return EXTENSION_MAP[ext] || 'unsupported';
};
