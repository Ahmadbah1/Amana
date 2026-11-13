import {build} from 'esbuild';
import {mkdir,rm,copyFile,readFile,writeFile} from 'node:fs/promises';
await rm('public_site',{recursive:true,force:true});await mkdir('public_site/vendor',{recursive:true});
await build({stdin:{contents:"import {createClient} from '@supabase/supabase-js'; window.supabase={createClient};",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',minify:true,outfile:'public_site/vendor/supabase.js'});
await copyFile('node_modules/exceljs/dist/exceljs.min.js','public_site/vendor/exceljs.js');
await build({stdin:{contents:"import {jsPDF} from 'jspdf'; import QRCode from 'qrcode'; window.AmanaPDF={jsPDF,QRCode};",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',minify:true,outfile:'public_site/vendor/pdf-utils.js'});
await mkdir('public_site/assets/fonts',{recursive:true});await copyFile('assets/fonts/DejaVuSans.ttf','public_site/assets/fonts/DejaVuSans.ttf');
for(const name of ['index.html','style.css','app.js','auth.js','features.js','config.js'])await copyFile(name,'public_site/'+name);
console.log('Amana ready: public_site/index.html (SDK bundled, no CDN required for authentication)');
