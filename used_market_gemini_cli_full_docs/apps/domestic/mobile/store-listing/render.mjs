import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const source = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(source, '../artifacts/0.1.0/store-v2');
const data = JSON.parse(await fs.readFile(path.join(source, 'listing.ko.json'), 'utf8'));
if ([...data.name].length > 30 || [...data.shortDescription].length > 80 || [...data.fullDescription].length > 4000) throw Error('Play listing text exceeds field limits');
const packagePath = process.env.USED_PICK_ARTWORK_TOOLS;
const chrome = process.env.USED_PICK_ARTWORK_CHROME;
if (!packagePath || !chrome) throw Error('Set USED_PICK_ARTWORK_TOOLS to a package.json with playwright/sharp and USED_PICK_ARTWORK_CHROME to an installed Chromium');
const require = createRequire(path.resolve(packagePath));
const { chromium } = require('playwright');
const sharp = require('sharp');
const selected = process.argv.slice(2);
await fs.mkdir(output, { recursive: true });
// Generated payload lives with the ignored outputs, never embedded into production code.
const template = await fs.readFile(path.join(source, 'artwork.html'), 'utf8');
const base = pathToFileURL(source + path.sep).href;
const document = template.replace('<head>', `<head><base href="${base}">`).replace('<script src="listing-data.js"></script>', `<script>window.renderStoreArtwork(${JSON.stringify(data).replaceAll('<','\\u003c')});</script>`);
const htmlPath = path.join(output, 'preview.html');
await fs.writeFile(htmlPath, document);
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const receipt = { generatedAt: new Date().toISOString(), source: 'actual Android TWA screenshots; typography and layout in HTML/CSS', listing: { name: [...data.name].length, shortDescription: [...data.shortDescription].length, fullDescription: [...data.fullDescription].length }, files: [] };
try {
  for (const art of [...data.graphics, { id: 'feature', raw: data.graphics[0].raw }].filter(art => !selected.length || selected.includes(art.id))) {
    const context = await browser.newContext({ viewport: art.id === 'feature' ? { width:1024,height:500 } : {width:1080,height:1920}, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto(pathToFileURL(htmlPath).href+'?art='+art.id);
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(i=>i.decode()))});
    if(errors.length) throw Error(errors.join('; '));
    await fs.writeFile(path.join(output,art.id+'.dom.html'),await page.content());
    const raw=await page.screenshot({type:'png'});
    const filename=art.id==='feature'?'feature-1024x500.png':art.id+'.png';
    const target=path.join(output,filename);
    await sharp(raw).removeAlpha().png().toFile(target);
    const result=await fs.readFile(target),meta=await sharp(result).metadata();
    receipt.files.push({ file:filename,width:meta.width,height:meta.height,channels:meta.channels,bytes:result.length,sha256:crypto.createHash('sha256').update(result).digest('hex'),actualCapture:art.raw });
    await context.close();
  }
  if (!selected.length) {
  const context=await browser.newContext({viewport:{width:1440,height:1370},deviceScaleFactor:1});
  const page=await context.newPage();await page.goto(pathToFileURL(htmlPath).href);await page.evaluate(()=>document.fonts.ready);await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(i=>i.decode()))});await page.screenshot({path:path.join(output,'overview-desktop.png')});await page.locator('.grid').screenshot({path:path.join(output,'screenshots-overview.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'overview-mobile.png')});
  receipt.galleryOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(output,'artwork-receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
