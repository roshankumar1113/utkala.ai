const fs = require('fs');
const path = require('path');

// 1. CLEAN UP INDEX.HTML (Ensure only ONE single input bar)
const indexPath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Find the position of the first </main> and imagePreviewBadge
// We want one clean chat-app structure:
// <div class="app-root">
//   <aside ...>...</aside>
//   <div class="chat-app">
//     <header>...</header>
//     <main id="chatViewport" class="conversation-viewport">
//       ...
//     </main>
//     <footer class="input-wrapper" style="flex-direction:column;align-items:stretch;gap:4px;">
//       ...
//     </footer>
//   </div>
// </div>

// Remove any duplicate footer / second input bar
const secondFooterRegex = /<\/main>\s*<!-- FOOTER INPUT AREA -->\s*<footer class="input-wrapper">[\s\S]*?<\/footer>/gi;
html = html.replace(secondFooterRegex, '');

// Also remove any duplicate chatInput if multiple exist
const chatInputMatches = [...html.matchAll(/id="chatInput"/g)];
if (chatInputMatches.length > 1) {
  console.log(`Found ${chatInputMatches.length} chatInput instances. Cleaning...`);
}

// Let's do exact structure normalization for the main/footer area
const mainEndIdx = html.indexOf('</main>');
if (mainEndIdx !== -1) {
  const afterMain = html.substring(mainEndIdx);
  const voiceCallIdx = html.indexOf('<div id="voiceCallOverlay"');
  if (voiceCallIdx !== -1) {
    const footerSection = html.substring(mainEndIdx, voiceCallIdx);
    
    // Create one single clean footer
    const cleanFooter = `</main>

      <!-- UNIFIED SINGLE INPUT AREA -->
      <footer class="input-wrapper" style="flex-direction:column;align-items:stretch;gap:4px;">
        <!-- Image Preview Badge -->
        <div id="imagePreviewBadge" class="image-preview-badge" style="display:none;">
          <img id="previewImgElement" src="" alt="preview">
          <span id="previewImgName">image.png</span>
          <span id="previewImgRemove" class="image-preview-del" title="Remove attachment">✕</span>
        </div>

        <div style="display:flex;align-items:flex-end;gap:8px;width:100%;">
          <!-- Attachment Button -->
          <button id="attachFileBtn" class="attachment-btn" title="Attach Image or Document / ଚିତ୍ର ବା ଫାଇଲ୍ ଯୋଡ଼ନ୍ତୁ">
            <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
          </button>
          <input type="file" id="chatAttachmentInput" accept="image/*,.pdf" style="display:none;">

          <!-- Voice Mic Trigger Button (Voice Call Overlay) -->
          <button id="callModeBtn" class="voice-mic-btn" title="Start Live Voice Call / କଣ୍ଠସ୍ୱର କାରବାର">
            <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          </button>

          <!-- Main Input Textarea -->
          <textarea id="chatInput" class="chat-textarea" placeholder="Type or speak in any language (Odia, English, Hindi...) - Utkal answers in Odia" rows="1"></textarea>

          <!-- Speak to Type / Dictation Mic Button -->
          <button id="dictateMicBtn" class="dictate-mic-btn" title="Speak to Type / କଣ୍ଠସ୍ୱର ଦ୍ୱାରା ଲେଖନ୍ତୁ">
            <svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
          </button>

          <!-- Send Message Button -->
          <button id="sendBtn" class="send-btn" title="Send Message">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </footer>
    </div> <!-- chat-app -->
  </div> <!-- app-root -->

  `;
    html = html.substring(0, mainEndIdx) + cleanFooter + html.substring(voiceCallIdx);
  }
}

// Make sure Gemini badge is gone
html = html.replace(/<span class="status-badge active"[^>]*>[\s\S]*?Gemini 2\.5 \+ Sarvam RAG[\s\S]*?<\/span>/gi, '');

// Make sure vocabulary card is gone
html = html.replace(/<div class="welcome-preset-card[^"]*" onclick="sendPreset\([^)]*ବିପରୀତ ଶବ୍ଦ[^)]*\)">[\s\S]*?<\/div>/gi, '');

fs.writeFileSync(indexPath, html, 'utf8');
console.log('✅ Single input bar structure created in public/index.html!');

// 2. DELETE TEMPORARY / UNNECESSARY FILES
const scriptsDir = path.join(__dirname);
const tempScripts = [
  'clean-cards.js',
  'check-status.js',
  'find-gemini.js',
  'fix-frontend.js',
  'inspect-cards.js',
  'inspect-lines.js',
  'remove-requested-items.js',
  'search-and-remove.js',
  'surgical-fix.js',
  'test-http.js',
  'verify-all.js'
];

for (const f of tempScripts) {
  const p = path.join(scriptsDir, f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`🗑️ Deleted temporary file: scripts/${f}`);
  }
}

console.log('🎉 Cleanup completed successfully!');
