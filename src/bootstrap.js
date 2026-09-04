import { IS_MOBILE } from './platform.js';
if (IS_MOBILE) {
  document.getElementById('loading-screen')?.remove();
  const blocker = document.getElementById('mobile-block-screen');
  blocker.style.display = 'flex';
  blocker.querySelector('.mobile-url-box').textContent = location.host;
  const button = document.getElementById('mobile-copy-btn');
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); button.textContent = 'LINK COPIED'; }
    catch { button.textContent = 'Copy the address from your browser'; }
  });
} else {
  import('./main.js').catch((error) => {
    console.error('Game could not start', error);
    document.getElementById('loading-status').textContent = 'Unable to start graphics. Reload or try another browser.';
  });
}
