/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: produces a plain out/ folder of HTML/JS/CSS with
  // no Node server required — this is what lets the app deploy to
  // Netlify (or any static host) with zero backend, per the brief's
  // "no persistent backend" requirement. All calculations run
  // client-side in the browser.
  output: 'export',
};

module.exports = nextConfig;
