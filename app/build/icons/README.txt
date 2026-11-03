OziCut brand assets

Master vector: public/brand/ozicut-mark.svg
Web: public/favicon.svg, favicon.ico, favicon-32.png, apple-touch-icon.png
Desktop: build/icons/ozicut.png (1024px), ozicut.ico (16–256px), ozicut.icns (16–1024px)

The mark adapts the Ozirus logo (open ring + sparkle) for editing: a play symbol sits inside the ring. The mark uses a transparent outer background and a self-contained purple tile, so it works on both app themes.

To regenerate raster/native formats from the master: node scripts/build-brand.mjs
To verify the integrated logo and favicon assets: node scripts/brand-check.mjs
These scripts use the locally installed Chrome/Electron runtimes; they do not call external services.
