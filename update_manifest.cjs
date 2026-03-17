const fs = require('fs');
const path = require('path');

const faviconPath = path.join(__dirname, 'src', 'faviconBase64.ts');
const manifestPath = path.join(__dirname, 'public', 'manifest.json');
const icon192Path = path.join(__dirname, 'public', 'icon-192.png');
const icon512Path = path.join(__dirname, 'public', 'icon-512.png');
const faviconPngPath = path.join(__dirname, 'public', 'favicon.png');

const faviconContent = fs.readFileSync(faviconPath, 'utf8');
const match = faviconContent.match(/export const faviconBase64 = '(.*?)';/);

if (match && match[1]) {
  const base64String = match[1];
  
  // Extract the raw base64 data (remove the data URI prefix)
  const base64Data = base64String.replace(/^data:image\/png;base64,/, "");
  const buffer = Buffer.from(base64Data, 'base64');
  
  // Write the PNG files
  fs.writeFileSync(icon192Path, buffer);
  fs.writeFileSync(icon512Path, buffer);
  fs.writeFileSync(faviconPngPath, buffer);
  
  const manifest = {
    "name": "LinkVaultPro",
    "short_name": "LinkVaultPro",
    "description": "Your personal link & note vault",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#ffffff",
    "theme_color": "#000000",
    "orientation": "portrait-primary",
    "icons": [
      {
        "src": `data:image/png;base64,${base64Data}`,
        "sizes": "192x192",
        "type": "image/png",
        "purpose": "any maskable"
      },
      {
        "src": `data:image/png;base64,${base64Data}`,
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "any maskable"
      }
    ]
  };
  
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Manifest and icons updated successfully.');
} else {
  console.error('Could not extract base64 string from faviconBase64.ts');
}
