#!/usr/bin/env node
/* ============================================================
 *  打包：把整个游戏压成一个 .html
 *  - CSS / JS 全部内联
 *  - 像素字体按 unicode-range 切成 70 个分片，逐片转 base64 内联
 *  - 产物双击就能玩，也可以直接丢到任意静态托管
 *
 *  用法：node tools/build-single.js [--no-font]
 *    --no-font  不内联字体（体积从 ~3MB 降到 ~200KB，回退系统字体）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'candy-house.html');
const INLINE_FONT = !process.argv.includes('--no-font');

const warnings = [];
const read = p => fs.readFileSync(p, 'utf8');
const bin = p => fs.readFileSync(p);
const has = p => fs.existsSync(p);
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const kb = n => (n / 1024).toFixed(1) + ' KB';

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

/* CSS 里所有 url(...) 换成 data URI（字体分片就走这条路） */
function inlineCss(cssPath) {
  const dir = path.dirname(cssPath);
  let css = read(cssPath);
  let done = 0;
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, q, url) => {
    if (/^(data:|https?:|\/\/|#)/i.test(url)) return whole;
    const file = path.resolve(dir, url);
    if (!has(file)) { warnings.push('CSS 里引用了不存在的资源：' + rel(file)); return whole; }
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    done++;
    return `url("data:${mime};base64,${bin(file).toString('base64')}")`;
  });
  return { css, assets: done };
}

function build() {
  const indexPath = path.join(ROOT, 'index.html');
  if (!has(indexPath)) throw new Error('找不到 index.html：' + indexPath);
  let html = read(indexPath);
  const stats = { css: [], js: [], assets: 0, fontInlined: false };

  /* ---- <link rel="stylesheet" href="..."> ---- */
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) return tag;
    const file = path.resolve(ROOT, m[1]);
    if (!has(file)) { warnings.push('找不到样式：' + m[1]); return tag; }
    const isFontCss = /poxiao/i.test(m[1]);
    if (isFontCss && !INLINE_FONT) {
      // 不内联字体：这条 link 直接删掉，让 CSS 的 fallback 字体栈接手
      return '<!-- 字体未内联（--no-font） -->';
    }
    const out = inlineCss(file);
    stats.css.push(rel(file));
    stats.assets += out.assets;
    if (isFontCss) { stats.fontInlined = INLINE_FONT; stats.fontFiles = out.assets; }
    return `<style>\n/* ${rel(file)} */\n${out.css}\n</style>`;
  });

  /* ---- <script src="..."></script>，保持原有顺序 ---- */
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, inner) => {
    const m = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    if (!m) return whole;
    const file = path.resolve(ROOT, m[1]);
    if (!has(file)) { warnings.push('找不到脚本：' + m[1]); return whole; }
    let js = read(file);
    // JS 里出现 </script> 字面量会把标签提前闭合
    if (/<\/script/i.test(js)) {
      warnings.push('脚本里有 </script> 字面量，已转义：' + m[1]);
      js = js.replace(/<\/script/gi, '<\\/script');
    }
    stats.js.push(rel(file));
    return `<script>\n/* ${rel(file)} */\n${js}\n</script>`;
  });

  /* ---- 打包水印 ---- */
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  html = html.replace(/<head>/i, `<head>
<!-- 糖果屋 · 单文件构建 ${stamp} · 字体${INLINE_FONT ? '已内联' : '未内联'} -->`);

  /* ---- 残留的外部引用 ---- */
  const leftovers = [];
  html.replace(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi, (w, u) => {
    if (/^(data:|https?:|#|mailto:)/i.test(u)) return w;
    leftovers.push(u);
    return w;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');

  const size = fs.statSync(OUT_FILE).size;
  return { stats, leftovers, size };
}

try {
  const { stats, leftovers, size } = build();
  console.log('');
  console.log('  样式：' + (stats.css.length ? stats.css.join(', ') : '无'));
  console.log('  脚本：' + stats.js.join(', '));
  console.log('  字体：' + (stats.fontInlined ? `已内联 ${stats.fontFiles} 个分片` : '未内联（系统字体回退）'));
  console.log('  内联资源：' + stats.assets + ' 个');
  console.log('  产物：' + rel(OUT_FILE) + '  (' + kb(size) + ')');
  if (leftovers.length) {
    console.log('');
    console.log('  [!] 还有外部引用没内联，发布时记得一起带上：');
    [...new Set(leftovers)].forEach(u => console.log('      - ' + u));
  }
  if (warnings.length) {
    console.log('');
    console.log('  [!] 警告：');
    [...new Set(warnings)].forEach(w => console.log('      - ' + w));
  }
  console.log('');
  process.exit(0);
} catch (e) {
  console.error('');
  console.error('  [x] 打包失败：' + (e && e.message ? e.message : e));
  console.error('');
  process.exit(1);
}
