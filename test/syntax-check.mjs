// Sanity-check that every source file parses/loads without errors on the
// current platform (Windows), since only linux.ts gets exercised on Linux.
const mods = [
  "../streamAudioRouter/platform/linux.ts",
  "../streamAudioRouter/platform/windows.ts",
  "../streamAudioRouter/platform/macos.ts",
];

for (const m of mods) {
  await import(m);
  console.log("ok - loaded", m);
}
